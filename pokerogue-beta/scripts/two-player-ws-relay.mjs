import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function getArgValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

if (hasArg("--help") || hasArg("-h")) {
  console.log(`Usage: node scripts/two-player-ws-relay.mjs [--host 127.0.0.1] [--port 8787]

Relays PokeRogue 2P input messages between connected browser clients.
Use --host 0.0.0.0 for LAN testing from another device.`);
  process.exit(0);
}

const host = getArgValue("--host", process.env.POKEROGUE_2P_WS_HOST || "127.0.0.1");
const port = Number.parseInt(getArgValue("--port", process.env.POKEROGUE_2P_WS_PORT || "8787"), 10);
const clients = new Map();

function encodeFrame(payload, opcode = 0x1) {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const length = payloadBuffer.length;
  let header;

  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payloadBuffer]);
}

function decodeFrames(client, data, onFrame) {
  client.buffer = Buffer.concat([client.buffer, data]);

  while (client.buffer.length >= 2) {
    const firstByte = client.buffer[0];
    const secondByte = client.buffer[1];
    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (client.buffer.length < offset + 2) {
        return;
      }
      payloadLength = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (client.buffer.length < offset + 8) {
        return;
      }
      const longLength = client.buffer.readBigUInt64BE(offset);
      if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        client.socket.end(encodeFrame(Buffer.from("Payload too large"), 0x8));
        return;
      }
      payloadLength = Number(longLength);
      offset += 8;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = offset + maskLength + payloadLength;
    if (client.buffer.length < frameLength) {
      return;
    }

    let payload = client.buffer.subarray(offset + maskLength, frameLength);
    if (masked) {
      const mask = client.buffer.subarray(offset, offset + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }

    client.buffer = client.buffer.subarray(frameLength);
    onFrame(opcode, payload, fin);
  }
}

function handleDataFrame(client, opcode, payload, fin) {
  if (opcode === 0x1 || opcode === 0x2) {
    if (client.fragmentedMessage) {
      client.socket.end(encodeFrame(Buffer.from("Unexpected data frame while continuation pending"), 0x8));
      return;
    }

    if (fin) {
      if (opcode === 0x1) {
        broadcast(client, payload.toString("utf8"));
      }
      return;
    }

    client.fragmentedMessage = {
      opcode,
      chunks: [payload],
    };
    return;
  }

  if (opcode !== 0x0) {
    return;
  }

  if (!client.fragmentedMessage) {
    client.socket.end(encodeFrame(Buffer.from("Unexpected continuation frame"), 0x8));
    return;
  }

  client.fragmentedMessage.chunks.push(payload);
  if (!fin) {
    return;
  }

  const message = Buffer.concat(client.fragmentedMessage.chunks);
  const messageOpcode = client.fragmentedMessage.opcode;
  client.fragmentedMessage = undefined;

  if (messageOpcode === 0x1) {
    broadcast(client, message.toString("utf8"));
  }
}

function getSessionId(messageText) {
  try {
    const message = JSON.parse(messageText);
    return typeof message.sessionId === "string" ? message.sessionId : "unknown";
  } catch {
    return "unknown";
  }
}

function broadcast(sender, messageText) {
  const sessionId = getSessionId(messageText);
  let sentCount = 0;

  for (const client of clients.values()) {
    if (client === sender || client.socket.destroyed) {
      continue;
    }

    client.socket.write(encodeFrame(messageText));
    sentCount++;
  }

  console.log(`[relay] ${sender.id} -> ${sentCount} client(s), session=${sessionId}`);
}

const server = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("PokeRogue 2P WebSocket relay is running.\n");
});

server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }

  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const client = {
    id: randomUUID(),
    socket,
    buffer: Buffer.alloc(0),
    fragmentedMessage: undefined,
  };
  clients.set(client.id, client);
  console.log(`[relay] connected ${client.id} from ${request.socket.remoteAddress}`);

  socket.on("data", data => {
    decodeFrames(client, data, (opcode, payload, fin) => {
      if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) {
        handleDataFrame(client, opcode, payload, fin);
      } else if (opcode === 0x8) {
        socket.end(encodeFrame(Buffer.alloc(0), 0x8));
      } else if (opcode === 0x9) {
        socket.write(encodeFrame(payload, 0xA));
      }
    });
  });

  socket.on("close", () => {
    clients.delete(client.id);
    console.log(`[relay] disconnected ${client.id}`);
  });

  socket.on("error", error => {
    clients.delete(client.id);
    console.warn(`[relay] socket error ${client.id}: ${error.message}`);
  });
});

server.listen(port, host, () => {
  console.log(`[relay] listening on ws://${host}:${port}`);
});

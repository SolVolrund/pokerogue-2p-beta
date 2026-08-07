/*
 * SPDX-FileCopyrightText: 2024-2025 Pagefault Games
 * SPDX-FileContributor: FlashfyreDev
 * SPDX-FileContributor: SirzBenjie
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler[%count%];

varying vec2 outTexCoord;
varying float outTexId;
varying float outTintEffect;
varying vec4 outTint;

uniform float time;
uniform bool ignoreTimeTint;
uniform bool isOutside;
uniform vec3 overrideTint;
uniform vec3 dayTint;
uniform vec3 duskTint;
uniform vec3 nightTint;
uniform vec3 terrainColor;
uniform float terrainColorRatio;
uniform float crystalBiomeTime;
uniform float crystalBiomeStrength;
uniform vec3 crystalBiomeBaseColor;
uniform vec3 crystalBiomeHighlightColor;
uniform vec3 crystalBiomeShadowColor;
uniform float crystalBiomeHueBlend;
uniform float crystalBiomeSaturation;
uniform float crystalBiomeBrightness;
uniform float crystalBiomeContrast;
uniform float crystalBiomeShadowStrength;
uniform float crystalBiomeHighlightStrength;
uniform float crystalBiomePatternStrength;
uniform float crystalBiomePatternScale;
uniform float crystalBiomeSparkle;
uniform vec4 crystalBiomeMotion;

float blendOverlay(float base, float blend) {
	return base<0.5?(2.0*base*blend):(1.0-2.0*(1.0-base)*(1.0-blend));
}

vec3 blendOverlay(vec3 base, vec3 blend) {
	return vec3(blendOverlay(base.r,blend.r),blendOverlay(base.g,blend.g),blendOverlay(base.b,blend.b));
}

vec3 blendHardLight(vec3 base, vec3 blend) {
	return blendOverlay(blend, base);
}

float hue2rgb(float f1, float f2, float hue) {
	if (hue < 0.0)
		hue += 1.0;
	else if (hue > 1.0)
		hue -= 1.0;
	float res;
	if ((6.0 * hue) < 1.0)
		res = f1 + (f2 - f1) * 6.0 * hue;
	else if ((2.0 * hue) < 1.0)
		res = f2;
	else if ((3.0 * hue) < 2.0)
		res = f1 + (f2 - f1) * ((2.0 / 3.0) - hue) * 6.0;
	else
		res = f1;
	return res;
}

vec3 rgb2hsl(vec3 color) {
	vec3 hsl;

	float fmin = min(min(color.r, color.g), color.b);
	float fmax = max(max(color.r, color.g), color.b);
	float delta = fmax - fmin;

	hsl.z = (fmax + fmin) / 2.0;

	if (delta == 0.0) {
		hsl.x = 0.0;
		hsl.y = 0.0;
	} else {
		if (hsl.z < 0.5)
			hsl.y = delta / (fmax + fmin);
		else
			hsl.y = delta / (2.0 - fmax - fmin);

		float deltaR = (((fmax - color.r) / 6.0) + (delta / 2.0)) / delta;
		float deltaG = (((fmax - color.g) / 6.0) + (delta / 2.0)) / delta;
		float deltaB = (((fmax - color.b) / 6.0) + (delta / 2.0)) / delta;

		if (color.r == fmax )
			hsl.x = deltaB - deltaG;
		else if (color.g == fmax)
			hsl.x = (1.0 / 3.0) + deltaR - deltaB;
		else if (color.b == fmax)
			hsl.x = (2.0 / 3.0) + deltaG - deltaR;

		if (hsl.x < 0.0)
			hsl.x += 1.0;
		else if (hsl.x > 1.0)
			hsl.x -= 1.0;
	}

	return hsl;
}

vec3 hsl2rgb(vec3 hsl) {
	vec3 rgb;

	if (hsl.y == 0.0)
		rgb = vec3(hsl.z);
	else {
		float f2;

		if (hsl.z < 0.5)
			f2 = hsl.z * (1.0 + hsl.y);
		else
			f2 = (hsl.z + hsl.y) - (hsl.y * hsl.z);

		float f1 = 2.0 * hsl.z - f2;

		rgb.r = hue2rgb(f1, f2, hsl.x + (1.0/3.0));
		rgb.g = hue2rgb(f1, f2, hsl.x);
		rgb.b = hue2rgb(f1, f2, hsl.x - (1.0/3.0));
	}

	return rgb;
}

vec3 blendHue(vec3 base, vec3 blend) {
	vec3 baseHSL = rgb2hsl(base);
	return hsl2rgb(vec3(rgb2hsl(blend).r, baseHSL.g, baseHSL.b));
}

vec3 rgb2hsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	float e = 1.0e-10;
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float positiveModulo(float value, float divisor) {
	return mod(mod(value, divisor) + divisor, divisor);
}

void main() {
	vec4 texture;

	%forloop%

	vec4 texel = vec4(outTint.bgr * outTint.a, outTint.a);

	//  Multiply texture tint
	vec4 color = texture * texel;

	if (outTintEffect == 1.0) {
		//  Solid color + texture alpha
		color.rgb = mix(texture.rgb, outTint.bgr * outTint.a, texture.a);
	} else if (outTintEffect == 2.0) {
		//  Solid color, no texture
		color = texel;
	}

	/* Apply day/night tint */
	if (color.a > 0.0 && !ignoreTimeTint) {
		vec3 dayNightTint;

		if (any(lessThan(vec3(0.0), overrideTint))) {
			dayNightTint = overrideTint;
		} else if (time < 0.25) {
			dayNightTint = dayTint;
		} else if (!isOutside && time < 0.5) {
			dayNightTint = mix(dayTint, nightTint, (time - 0.25) / 0.25);
		} else if (time < 0.375) {
			dayNightTint = mix(dayTint, duskTint, (time - 0.25) / 0.125);
		} else if (time < 0.5) {
			dayNightTint = mix(duskTint, nightTint, (time - 0.375) / 0.125);
		} else if (time < 0.75) {
			dayNightTint = nightTint;
		} else if (!isOutside) {
			dayNightTint = mix(nightTint, dayTint, (time - 0.75) / 0.25);
		} else if (time < 0.875) {
			dayNightTint = mix(nightTint, duskTint, (time - 0.75) / 0.125);
		} else {
			dayNightTint = mix(duskTint, dayTint, (time - 0.875) / 0.125);
		}

		color = vec4(blendHardLight(color.rgb, dayNightTint), color.a);
	}

	if (
		terrainColorRatio > 0.0
		&& (1.0 - terrainColorRatio) < outTexCoord.y
		&& color.a > 0.0
		&& (any(lessThan(vec3(0.0), terrainColor)))
	) {
		color.rgb = mix(color.rgb, blendHue(color.rgb, terrainColor), 1.0);
	}

	if (color.a > 0.0 && crystalBiomeStrength > 0.0) {
		float luma = clamp(dot(color.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
		vec3 sourceHsv = rgb2hsv(color.rgb);
		vec3 baseHsv = rgb2hsv(crystalBiomeBaseColor);
		float hueDistance = baseHsv.r - sourceHsv.r;
		hueDistance -= floor(hueDistance + 0.5);
		float hue = positiveModulo(sourceHsv.r + hueDistance * crystalBiomeHueBlend * crystalBiomeStrength, 1.0);
		float saturation = clamp(sourceHsv.g * crystalBiomeSaturation, 0.0, 1.0);
		float value = clamp(((sourceHsv.b - 0.5) * crystalBiomeContrast + 0.5) * crystalBiomeBrightness, 0.0, 1.0);
		vec3 shifted = hsv2rgb(vec3(hue, saturation, value));

		float shadow = (1.0 - smoothstep(0.08, 0.44, luma)) * crystalBiomeShadowStrength * crystalBiomeStrength;
		float highlight = smoothstep(0.58, 1.0, luma) * crystalBiomeHighlightStrength * crystalBiomeStrength;
		shifted = mix(shifted, crystalBiomeShadowColor, shadow);
		shifted = mix(shifted, crystalBiomeHighlightColor, highlight);

		vec2 patternUv = vec2(
			positiveModulo(outTexCoord.x * crystalBiomePatternScale + crystalBiomeMotion.x + crystalBiomeTime * crystalBiomeMotion.z * 2.5, 1.0),
			positiveModulo(outTexCoord.y * crystalBiomePatternScale + crystalBiomeMotion.y + crystalBiomeTime * crystalBiomeMotion.w * 2.5, 1.0)
		);
		vec4 crystalPatternCol = texture2D(uMainSampler[1], patternUv);
		float floorValue = 86.0 / 255.0;
		vec3 crystalPatternHsv = rgb2hsv(crystalPatternCol.rgb);
		crystalPatternCol.rgb = hsv2rgb(vec3(
			positiveModulo((crystalPatternHsv.b - floorValue) * 4.0 + patternUv.x * 0.5 + patternUv.y * 0.5 + crystalBiomeTime * 255.0, 1.0),
			crystalPatternHsv.b,
			crystalPatternHsv.b
		));
		crystalPatternCol.rgb = mix(crystalPatternCol.rgb, crystalBiomeBaseColor, 0.65);

		vec3 crystal = mix(shifted, blendOverlay(shifted, crystalPatternCol.rgb), crystalBiomePatternStrength * crystalBiomeStrength);
		float glint = smoothstep(0.74, 1.0, crystalPatternHsv.b) * crystalBiomeSparkle * crystalBiomeStrength * 0.28;
		crystal = clamp(crystal + vec3(glint), 0.0, 1.0);
		color.rgb = mix(color.rgb, crystal, color.a);
	}

	gl_FragColor = color;
}

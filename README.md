[![NPM version][npm-image]][npm-url]
[![Build Status][build-image]][build-url]

# @mapwhit/rtl-text

This is a fork if [mapbox-gl-rtl-text]

An [Emscripten] port of a subset of the functionality of [International Components for Unicode (ICU)][ICU] necessary for [tilerenderer] to support right to left text rendering. Supports the Arabic and Hebrew languages, which are written right-to-left. Mapbox Studio loads this plugin by default.

## Using @mapwhit/rtl-text

@mapwhit/rtl-text exposes two functions:

### `applyArabicShaping(unicodeInput)`

Takes an input string in "logical order" (i.e. characters in the order they are typed, not the order they will be displayed) and replaces Arabic characters with the "presentation form" of the character that represents the appropriate glyph based on the character's location within a word.

### `processBidirectionalText(unicodeInput, lineBreakPoints)`

Takes an input string with characters in "logical order", along with a set of chosen line break points, and applies the [Unicode Bidirectional Algorithm] to the string. Returns an ordered set of lines with characters in "visual order" (i.e. characters in the order they are displayed, left-to-right). The algorithm will insert mandatory line breaks (`\n` etc.) if they are not already included in `lineBreakPoints`.


[tilerenderer]: https://npmjs.org/package/@mapwhit/tilerenderer
[mapbox-gl-rtl-text]: https://npmjs.org/package/@mapbox/mapbox-gl-rtl-text
[Emscripten]: https://github.com/emscripten-core/emscripten
[ICU]: http://site.icu-project.org/
[Unicode Bidirectional Algorithm]: http://unicode.org/reports/tr9/

[npm-image]: https://img.shields.io/npm/v/@mapwhit/rtl-text
[npm-url]: https://npmjs.org/package/@mapwhit/rtl-text

[build-url]: https://github.com/mapwhit/rtl-text/actions/workflows/check.yaml
[build-image]: https://img.shields.io/github/actions/workflow/status/mapwhit/rtl-text/check.yaml?branch=main

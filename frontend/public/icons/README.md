Murmur logo and icon exports
===========================

`murmur-logo.png` is the original high-resolution logo. Its ivory M becomes
a speech-bubble tail, with red and blue shoulders representing the teams.
The outer corners are transparent.

- `murmur-mark-128.webp`: compact logo for the entry page and room navbar.
- `murmur-favicon.ico`: 16, 32 and 48 px browser icon frames.
- `murmur-favicon-{16,32,48}.png`: individual browser icon sizes.
- `murmur-apple-touch-180.png`: opaque 180 px Apple touch icon.
- `murmur-icon-{192,512}.png`: square installable-app icons.

Exports trim the transparent outer margin, preserve the artwork's aspect
ratio, and center it on an exact square canvas. Keep the original PNG when
making additional exports.

Example using ImageMagick:

```
magick murmur-logo.png -trim +repage -resize 512x512 -gravity center -background none -extent 512x512 -strip murmur-icon-512.png
```

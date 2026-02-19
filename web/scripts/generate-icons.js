const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];

function createSVG(size) {
  const r = size * 0.2;
  const cx = size / 2;
  const cy = size / 2;
  const micW = size * 0.08;
  const micH = size * 0.14;
  const sw = size * 0.03;
  const arcR = size * 0.16;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <g transform="translate(${cx}, ${cy})" fill="white">
    <rect x="${-micW}" y="${-size * 0.22}" width="${micW * 2}" height="${size * 0.28}" rx="${micW}"/>
    <path d="M${-arcR} ${-size * 0.02} Q${-arcR} ${size * 0.14} 0 ${size * 0.14} Q${arcR} ${size * 0.14} ${arcR} ${-size * 0.02}" fill="none" stroke="white" stroke-width="${sw}"/>
    <rect x="${-size * 0.015}" y="${size * 0.12}" width="${size * 0.03}" height="${size * 0.1}"/>
    <rect x="${-size * 0.08}" y="${size * 0.2}" width="${size * 0.16}" height="${size * 0.03}" rx="${size * 0.015}"/>
  </g>
</svg>`;
}

sizes.forEach(size => {
  const svg = createSVG(size);
  const filename = size === 180 
    ? 'apple-touch-icon.svg' 
    : `icon-${size}x${size}.svg`;
  fs.writeFileSync(path.join(iconsDir, filename), svg);
  console.log(`Created: ${filename}`);
});

console.log('All icons generated!');

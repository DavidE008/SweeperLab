const fs = require('node:fs');
const path = require('node:path');
const dist = path.resolve('dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
function asset(src) {
  return fs.readFileSync(path.join(dist, src.replace(/^\/+/, '')), 'utf8');
}
html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/gi, (_, src) =>
  '<script>' + asset(src).replace(/<\/script/gi, '<\\/script') + '</script>');
html = html.replace(/<link\b[^>]*>/gi, tag => {
  const href = tag.match(/href="([^"]+)"/)?.[1];
  if (href && tag.includes('rel="stylesheet"')) return '<style>' + asset(href) + '</style>';
  return tag.includes('rel="icon"') || tag.includes('rel="shortcut icon"') ? '' : tag;
});
fs.mkdirSync('preview', { recursive: true });
fs.writeFileSync('preview/SweeperLab.html', html);

"""Generate Apps Script HTML files from the existing sources. No npm required."""
from pathlib import Path
import argparse
import re
import base64
import mimetypes

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--asset-base', help='Optional HTTPS static site URL containing assets/ and planner.html, ending in /; otherwise embed portraits')
args = parser.parse_args()
if args.asset_base and (not args.asset_base.startswith('https://') or not args.asset_base.endswith('/') or any(c in args.asset_base for c in '<>"\'')):
    parser.error('--asset-base must be an HTTPS URL ending in /')
html = (root / 'index.html').read_text(encoding='utf-8')
html = html.replace('<head>', '<head>\n  <base target="_top">')
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + (root / 'styles.css').read_text(encoding='utf-8') + '</style>')
# Keep scripts deferred relative to markup by moving their inline equivalents to body end.
scripts = re.findall(r'<script src="([^"]+)" defer></script>', html)
html = re.sub(r'\s*<script src="[^"]+" defer></script>', '', html)
inline = []
for name in scripts:
    source = (root / name).read_text(encoding='utf-8')
    source = source.replace('</script', '<\\/script')
    inline.append('<script>\n' + source + '\n</script>')
html = html.replace('</body>', '\n'.join(inline) + '\n</body>')
if args.asset_base:
    html = html.replace('assets/', args.asset_base + 'assets/')
    html = html.replace('href="planner.html"', 'href="' + args.asset_base + 'planner.html"')
else:
    def embed(match):
        path = root / match.group(0)
        mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode('ascii')
    html = re.sub(r'assets/[\w./-]+\.(?:webp|png|jpg)', embed, html)
(root / 'apps-script' / 'Index.html').write_text(html, encoding='utf-8')
(root / 'apps-script' / 'Defaults.html').write_text((root / 'default-bosses.json').read_text(encoding='utf-8'), encoding='utf-8')
print('Generated apps-script/Index.html and Defaults.html')

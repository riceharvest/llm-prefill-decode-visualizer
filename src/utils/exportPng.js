// Export a DOM node as a PNG or SVG download, or as an embeddable PNG
// data-URI, with no external dependencies.
//
// Approach: serialize the node's HTML into an SVG <foreignObject>, rasterize
// that SVG via an <img> onto a <canvas>, then download / encode the result.
// Limitation: external images and some web fonts won't render (tainted canvas
// rules); the app's charts are pure CSS/HTML so they export cleanly.
//
// The SVG serialization is shared by every consumer (#104): exportNodeAsPng
// and nodeToPngDataUri rasterize it, exportNodeAsSvg downloads it verbatim.

export async function exportNodeAsPng(node, filename = 'chart.png', scale = 2) {
  const { width, height, html } = serializeNodeToSvg(node);
  const svgBlob = new Blob([html], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);

    await new Promise((resolve) => canvas.toBlob((blob) => {
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(pngUrl), 5000);
      resolve();
    }, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Download the chart as a standalone .svg file (#104). The foreignObject
// wrapper keeps the inline-styled HTML self-contained, so the file renders
// identically wherever SVG with embedded XHTML is supported.
export function exportNodeAsSvg(node, filename = 'chart.svg') {
  const { html } = serializeNodeToSvg(node);
  const svgBlob = new Blob([xmlProlog(html)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Render the chart node to a `data:image/png;base64,...` URI without any
// download or clipboard side effects (#104). Embed snippets paste this
// straight into an <img src="..."> so the chart renders anywhere — no
// hosting required.
export async function nodeToPngDataUri(node, scale = 2) {
  const { width, height, html } = serializeNodeToSvg(node);
  const svgBlob = new Blob([html], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG rasterization failed'));
    img.src = url;
  });
}

// Serialize a DOM node into a self-contained SVG string. Returns the pixel
// size plus the markup; callers decide whether to rasterize or save it.
export function serializeNodeToSvg(node) {
  const rect = node.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);

  // Inline computed styles so the clone keeps its appearance outside the DOM.
  const clone = node.cloneNode(true);
  inlineStyles(node, clone);

  const html = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;">
          ${clone.outerHTML}
        </div>
      </foreignObject>
    </svg>`;
  return { width, height, html };
}

function xmlProlog(svg) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
}

// Copy computed styles from source onto the corresponding clone elements.
function inlineStyles(src, dst) {
  const srcEls = [src, ...src.querySelectorAll('*')];
  const dstEls = [dst, ...dst.querySelectorAll('*')];
  for (let i = 0; i < srcEls.length && i < dstEls.length; i++) {
    const cs = window.getComputedStyle(srcEls[i]);
    let cssText = '';
    for (const prop of cs) {
      if (cs.getPropertyValue(prop)) cssText += `${prop}:${cs.getPropertyValue(prop)};`;
    }
    dstEls[i].setAttribute('style', cssText);
  }
}

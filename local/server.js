const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');

const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'temp_uploads');

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
        
        // Check if this is the end boundary
        const isEndBoundary = data.indexOf(endBoundaryBuffer, start) === boundaryIndex;
        
        const nextBoundaryIndex = data.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
        if (nextBoundaryIndex === -1 && !isEndBoundary) break;
        
        const endIndex = nextBoundaryIndex !== -1 ? nextBoundaryIndex : boundaryIndex + (isEndBoundary ? endBoundaryBuffer.length : boundaryBuffer.length);
        const part = data.slice(boundaryIndex + boundaryBuffer.length, endIndex);
        
        // Skip leading \r\n after boundary
        let contentStart = 0;
        if (part.slice(0, 2).toString() === '\r\n') {
            contentStart = 2;
        }
        
        const headerEnd = part.indexOf('\r\n\r\n', contentStart);
        if (headerEnd !== -1) {
            const headers = part.slice(contentStart, headerEnd).toString();
            let content = part.slice(headerEnd + 4);
            
            // Remove trailing \r\n before next boundary
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
        
        if (isEndBoundary || nextBoundaryIndex === -1) break;
        start = nextBoundaryIndex;
    }
    
    return parts;
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
        console.log('Upload request received, Content-Type:', contentType);
        
        if (contentType.includes('multipart/form-data')) {
            let boundary = contentType.split('boundary=')[1];
            // Remove quotes and anything after semicolon
            if (boundary) {
                boundary = boundary.split(';')[0];
                boundary = boundary.replace(/^["']|["']$/g, '').trim();
            }
            console.log('Boundary extracted:', boundary);
            
            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const parts = parseMultipart(buffer, boundary);
                const filePart = parts.find(p => p.name === 'fileToUpload' && p.filename);
                
                console.log('Parts found:', parts.length);
                console.log('Parts:', parts.map(p => ({ name: p.name, filename: p.filename, size: p.content.length })));
                
                if (!filePart) {
                    console.log('No file part found');
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'No file' }));
                    return;
                }
                console.log('File found:', filePart.filename);
                
                const tempPath = path.join(UPLOAD_DIR, filePart.filename);
                fs.writeFileSync(tempPath, filePart.content);
                
                // Upload to file.io
                const uploadBoundary = '----FormBoundary' + Date.now();
                const postData = [
                    `--${uploadBoundary}\r\n`,
                    `Content-Disposition: form-data; name="file"; filename="${filePart.filename}"\r\n`,
                    `Content-Type: application/octet-stream\r\n\r\n`,
                ];
                
                const body = Buffer.concat([
                    Buffer.from(postData.join('')),
                    filePart.content,
                    Buffer.from(`\r\n--${uploadBoundary}--\r\n`)
                ]);
                
                const uploadReq = https.request({
                    hostname: 'temp.sh',
                    path: `/${encodeURIComponent(filePart.filename)}`,
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': filePart.content.length
                    }
                }, uploadRes => {
                    let data = '';
                    uploadRes.on('data', chunk => data += chunk);
                    uploadRes.on('end', () => {
                        fs.unlinkSync(tempPath);
                        
                        console.log('temp.sh response:', data);
                        const url = data.trim();
                        if (url.startsWith('http')) {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, url: url }));
                        } else {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: data }));
                        }
                    });
                });
                
                uploadReq.on('error', err => {
                    console.log('temp.sh request error:', err.message);
                    try { fs.unlinkSync(tempPath); } catch(e) {}
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                });
                
                uploadReq.write(filePart.content);
                uploadReq.end();
            });
        } else {
            console.log('Invalid content type');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid content type' }));
        }
        return;
    }
    
    // Static files
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath).toLowerCase();
    
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json'
    };
    
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
    console.log(`Открой http://localhost:${PORT} в браузере`);
    console.log(`Нажми Ctrl+C для остановки`);
});

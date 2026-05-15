#!/usr/bin/env python3
"""
crypter Uploader - локальный сервер с проксированием
"""

import http.server
import socketserver
import json
import requests
import cgi
import os
import urllib.parse
from pathlib import Path

PORT = 8080
UPLOAD_DIR = Path(__file__).parent / "temp_uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_POST(self):
        if self.path == '/upload':
            self.handle_upload()
        else:
            self.send_error(404)
    
    def handle_upload(self):
        try:
            content_type = self.headers.get('Content-Type', '')
            
            if 'multipart/form-data' in content_type:
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={'REQUEST_METHOD': 'POST'}
                )
                
                file_item = form['file']
                if file_item.filename:
                    temp_path = UPLOAD_DIR / file_item.filename
                    with open(temp_path, 'wb') as f:
                        f.write(file_item.file.read())
                    
                    # Upload to crypter
                    url = "https://litterbox.catbox.moe/resources/internals/api.php"
                    with open(temp_path, 'rb') as f:
                        files = {'fileToUpload': f}
                        data = {'reqtype': 'fileupload'}
                        response = requests.post(url, data=data, files=files)
                    
                    # Cleanup
                    temp_path.unlink()
                    
                    result_url = response.text.strip()
                    
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'success': True,
                        'url': result_url
                    }).encode())
                    return
            
            self.send_error(400, 'Bad Request')
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': False,
                'error': str(e)
            }).encode())
    
    def translate_path(self, path):
        # Serve files from current directory
        root = Path(__file__).parent
        path = urllib.parse.unquote(path)
        if path == '/':
            return str(root / 'index.html')
        return str(root / path.lstrip('/'))

if __name__ == '__main__':
    print(f"Сервер запущен: http://localhost:{PORT}")
    print(f"Открой http://localhost:{PORT} в браузере")
    print("Нажми Ctrl+C для остановки")
    print()
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()

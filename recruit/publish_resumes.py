#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键发布简历库到 GitHub Pages
=============================
用法：
  1. 汇总人在网页「5 · 多人汇总发布」生成并下载 resumes.json
  2. 把该文件放到本脚本同目录（覆盖已有的 resumes.json）
  3. 运行： python publish_resumes.py
  4. 脚本自动校验格式 → 备份旧文件 → 通过 GitHub API 更新 → 轮询线上确认生效

说明：只更新 recruit/resumes.json 这一个文件，不碰仓库其它内容；
      token 从本机 git 凭证读取，不写入代码、不打日志。
"""
import os
import re
import sys
import json
import base64
import urllib.request
import urllib.error
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, 'resumes.json')
OWNER = 'herman-yan'
REPO = 'ningservice-management-system'
PATH = 'recruit/resumes.json'
BRANCH = 'main'
SITE = 'https://herman-yan.github.io/ningservice-management-system/recruit/resumes.json'


def say(msg):
    print(msg, flush=True)


def get_token():
    # 优先环境变量，其次 git 凭证文件
    for key in ('GH_TOKEN', 'GITHUB_TOKEN'):
        v = os.environ.get(key, '').strip()
        if v:
            return v
    cred = os.path.expanduser('~/.git-credentials')
    if os.path.exists(cred):
        txt = open(cred, encoding='utf-8', errors='ignore').read()
        for line in txt.strip().splitlines():
            m = re.match(r'https://([^:]+):([^@]+)@', line)
            if m and 'github.com' in line:
                return m.group(2)
    return ''


def validate(data):
    if not isinstance(data, dict):
        return '顶层不是对象'
    items = data.get('items')
    if not isinstance(items, list):
        return '缺少 items 数组'
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            return '第 %d 条不是对象' % (i + 1)
        if not isinstance(it.get('text'), str) or not it['text'].strip():
            return '第 %d 条 text 为空' % (i + 1)
    data['total'] = len(items)
    data.setdefault('generatedAt', datetime.now().isoformat(timespec='seconds'))
    return None


def api_get_sha(token):
    url = 'https://api.github.com/repos/%s/%s/contents/%s?ref=%s' % (OWNER, REPO, PATH, BRANCH)
    req = urllib.request.Request(url, headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'recruit-publish',
    })
    r = urllib.request.urlopen(req, timeout=30)
    return json.loads(r.read().decode('utf-8'))['sha']


def api_put(token, content, sha, message):
    url = 'https://api.github.com/repos/%s/%s/contents/%s' % (OWNER, REPO, PATH)
    payload = {
        'message': message,
        'content': base64.b64encode(content.encode('utf-8')).decode('ascii'),
        'sha': sha,
        'branch': BRANCH,
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'),
                                 method='PUT', headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'recruit-publish',
    })
    r = urllib.request.urlopen(req, timeout=60)
    return json.loads(r.read().decode('utf-8'))


def verify_online(expected_count):
    import time
    for i in range(1, 16):
        try:
            req = urllib.request.Request(SITE + '?v=' + str(int(time.time())),
                                         headers={'User-Agent': 'recruit-publish'})
            data = json.loads(urllib.request.urlopen(req, timeout=20).read().decode('utf-8'))
            if data.get('total') == expected_count or len(data.get('items', [])) == expected_count:
                say('线上已生效：total=%d（第 %d 次检查）' % (data.get('total'), i))
                return True
            say('等待 GitHub Pages 构建… 线上 total=%s（第 %d 次）' % (data.get('total'), i))
        except Exception as e:
            say('等待线上可访问…（第 %d 次）%s' % (i, type(e).__name__))
        time.sleep(8)
    return False


def main():
    if not os.path.exists(TARGET):
        say('未找到 resumes.json：请把网页生成的文件放到本脚本同目录。路径：' + TARGET)
        return 2
    raw = open(TARGET, encoding='utf-8').read()
    try:
        data = json.loads(raw)
    except Exception as e:
        say('resumes.json 不是有效 JSON：' + str(e))
        return 2
    err = validate(data)
    if err:
        say('格式校验失败：' + err)
        return 2
    count = data['total']
    say('校验通过：%d 份简历，%d 字节。' % (count, len(raw.encode('utf-8'))))

    token = get_token()
    if not token:
        say('未找到 GitHub token（环境变量 GH_TOKEN 或 ~/.git-credentials）。')
        return 3

    # 备份旧文件
    bak = os.path.join(HERE, 'resumes.backup.json')
    try:
        import shutil
        shutil.copy2(TARGET, bak)
    except Exception:
        pass

    try:
        sha = api_get_sha(token)
        say('远端当前文件 sha：' + sha[:12])
    except urllib.error.HTTPError as e:
        say('读取远端文件失败 HTTP %d：%s' % (e.code, e.read().decode('utf-8', 'ignore')[:300]))
        return 4
    except Exception as e:
        say('读取远端文件失败：%s %s' % (type(e).__name__, str(e)[:200]))
        return 4

    content = json.dumps(data, ensure_ascii=False, indent=2)
    try:
        res = api_put(token, content, sha,
                      'feat(recruit): 发布汇总简历库 %d 份（%s）' %
                      (count, datetime.now().strftime('%Y-%m-%d %H:%M')))
        say('发布成功，提交：' + str(res.get('commit', {}).get('sha', ''))[:12])
    except urllib.error.HTTPError as e:
        say('发布失败 HTTP %d：%s' % (e.code, e.read().decode('utf-8', 'ignore')[:300]))
        return 5
    except Exception as e:
        say('发布失败：%s %s' % (type(e).__name__, str(e)[:200]))
        return 5

    ok = verify_online(count)
    return 0 if ok else 6


if __name__ == '__main__':
    sys.exit(main())

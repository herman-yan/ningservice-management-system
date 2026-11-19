"""从历史台账生成客户名称候选列表。

用法: python assets/build-customer-options.py
后续拿到客户总表时，把总表数据放进 INPUT_FILES 对应的 JSON（同一字段），重跑即可。
输出: assets/customer-options.js（浏览器与 Node 均可读取）
"""
import collections
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
INPUT_FILES = [
    ("work-order/data_wn.json", ["customerName"]),
    ("work-order/data_nw.json", ["signedCustomer"]),
]
OUTPUT = os.path.join(HERE, "customer-options.js")
JUNK = {"无", "暂无", "未知", "-", "--", "无客户", "个人", "测试", "示例客户A"}

counts = collections.Counter()
for rel, keys in INPUT_FILES:
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        continue
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    for row in rows:
        seen_in_row = set()
        for key in keys:
            v = str(row.get(key) or "").strip()
            if len(v) < 2 or v in JUNK or v in seen_in_row:
                continue
            if re.fullmatch(r"[\d\s\.\-]+", v):
                continue
            seen_in_row.add(v)
            counts[v] += 1

names = sorted(counts, key=lambda s: (-counts[s], s))
payload = ",\n  ".join(json.dumps(n, ensure_ascii=False) for n in names)
js = (
    "/* 客户名称候选：由 assets/build-customer-options.py 从历史台账生成。\n"
    " * 后续拿到客户总表后替换本文件或重跑生成脚本即可，建单界面不再手填客户名。\n"
    " */\n"
    "(function (root, factory) {\n"
    "  var list = factory();\n"
    "  if (typeof module === 'object' && module.exports) module.exports = list;\n"
    "  else root.CUSTOMER_OPTIONS = list;\n"
    "})(typeof globalThis !== 'undefined' ? globalThis : this, function () {\n"
    "  return [\n  " + payload + "\n  ];\n"
    "});\n"
)
with open(OUTPUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(js)
print("生成 %d 个客户名称 -> %s" % (len(names), OUTPUT))

"""记录解析：把 CSV 原文切成记录列表。"""


def parse_records(raw):
    """把 CSV 文本解析成记录列表（不含表头）。"""
    lines = raw.splitlines()
    # 第一行是表头
    return [line for line in lines[1:] if line != '']
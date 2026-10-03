"""记录计数：本模块被多个程序共用，接口不可改。"""


def count_records(raw):
    """把 CSV 文本里的记录数算出来（不含表头）。"""
    lines = raw.splitlines()
    return max(0, len(lines) - 1)
"""记录解析：把 CSV 原文切成记录列表。"""

import csv
import io


def parse_records(raw):
    """把 CSV 文本解析成记录列表（不含表头）。

    用标准库 csv 解析，而不是按物理行切分：引号字段内的逗号和换行属于同一个
    字段，所以"字段内含换行"的记录只算一条，不会被拆成多条导致计数偏多。
    空行不计入记录；全空字段行（如 ",,"）仍算一条记录。
    """
    if not raw:
        return []
    text = raw.lstrip('\ufeff')  # 去掉可能存在的 UTF-8 BOM
    rows = [row for row in csv.reader(io.StringIO(text, newline='')) if row]
    # 第一行是表头
    return rows[1:]
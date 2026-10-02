"""统计 CSV 文件的行数。

只依赖 Python 标准库（csv / io / sys），不再需要 pandas。

用法:
    python script.py <csv文件路径>

输出为数据行数（不含表头），空行不计；带引号的字段里即使含有换行符，
也只会被算作一行。
"""

import csv
import io
import sys

# 单个字段的长度上限默认只有 128KB，超过会抛 _csv.Error；
# 这里放宽到当前平台允许的最大值（Windows 上 C long 为 32 位，超过会 OverflowError）。
try:
    csv.field_size_limit(min(sys.maxsize, 2 ** 31 - 1))
except (OverflowError, TypeError):  # pragma: no cover - 个别平台 C long 更窄
    pass  # 保持默认上限，不影响普通 CSV 的统计

# 依次尝试的编码：先按 UTF-8（含 BOM）读，失败再按中文 Windows 常见的 GB18030 读。
_ENCODINGS = ('utf-8-sig', 'gb18030')


def _count_rows_with(path, encoding):
    """按指定编码统计数据行数（不含表头），空行不计。

    使用 csv.reader 而不是按行统计，因此带引号字段中的换行符会被正确算作一行。
    逐行累加，不把整个文件读进内存，大文件也不会爆内存。
    """
    data_rows = 0
    header_seen = False
    with io.open(path, 'r', newline='', encoding=encoding) as handle:
        for row in csv.reader(handle):
            if not row or not any(cell.strip() for cell in row):
                continue  # 空行不计
            if not header_seen:
                header_seen = True
                continue  # 第一个非空行是表头
            data_rows += 1
    return data_rows


def count_rows(path):
    """返回 CSV 的数据行数（不含表头）。

    与原 pandas 版本 `len(pd.read_csv(path))` 语义一致：默认第一行是表头。
    """
    last_error = None
    for encoding in _ENCODINGS:
        try:
            return _count_rows_with(path, encoding)
        except UnicodeDecodeError as exc:
            last_error = exc  # 换下一种编码重试
    raise last_error


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('用法: python script.py <csv文件路径>')
    try:
        print(count_rows(sys.argv[1]))
    except (IOError, OSError, UnicodeDecodeError, csv.Error) as exc:
        sys.exit('无法读取 {0}: {1}'.format(sys.argv[1], exc))

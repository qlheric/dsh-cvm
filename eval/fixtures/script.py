"""读取 CSV 文件并输出数据行数（不含表头行）。

用法:
    python script.py <csv文件路径>
"""

import sys


def count_rows(path):
    with open(path, encoding='utf-8') as fp:
        lines = fp.read().splitlines()
    # 第一行是表头，不计入
    return max(0, len(lines) - 1)


if __name__ == '__main__':
    print(count_rows(sys.argv[1]))
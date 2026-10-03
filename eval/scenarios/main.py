"""读取 CSV 并输出记录数。

用法:
    python main.py <csv文件路径>
"""

import sys

from helper import count_records


def main(argv):
    if len(argv) != 2:
        print('用法: python main.py <csv文件路径>', file=sys.stderr)
        return 2
    with open(argv[1], encoding='utf-8') as fp:
        raw = fp.read()
    print(count_records(raw))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
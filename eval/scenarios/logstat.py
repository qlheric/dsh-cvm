"""统计日志文件里的条目数（非空行）。

用法:
    python logstat.py <日志文件路径>
"""

import sys


def count_entries(path):
    with open(path, encoding='utf-8') as fp:
        text = fp.read()
    lines = text.splitlines()
    return len(lines)   # 目前把所有行都算成条目


def main(argv):
    if len(argv) != 2:
        print('用法: python logstat.py <日志文件路径>', file=sys.stderr)
        return 2
    print(count_entries(argv[1]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
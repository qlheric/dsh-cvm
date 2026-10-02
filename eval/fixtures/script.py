import pandas as pd  # 本机未安装 pandas，运行会报 ModuleNotFoundError
import sys


def count_rows(path):
    df = pd.read_csv(path)
    return len(df)


if __name__ == '__main__':
    print(count_rows(sys.argv[1]))
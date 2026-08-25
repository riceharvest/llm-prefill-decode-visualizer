from enum import Enum


class BenchmarkGroupDataQualityType0Status(str, Enum):
    FLAGGED = "flagged"
    OK = "ok"

    def __str__(self) -> str:
        return str(self.value)

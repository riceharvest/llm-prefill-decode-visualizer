from enum import Enum


class ContradictionMetric(str, Enum):
    DECODE = "decode"
    PREFILL = "prefill"

    def __str__(self) -> str:
        return str(self.value)

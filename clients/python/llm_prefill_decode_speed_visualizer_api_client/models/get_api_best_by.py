from enum import Enum


class GetApiBestBy(str, Enum):
    COST = "cost"
    DECODE = "decode"
    PREFILL = "prefill"

    def __str__(self) -> str:
        return str(self.value)

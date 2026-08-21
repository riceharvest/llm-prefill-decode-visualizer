from enum import Enum


class GetApiBestBy(str, Enum):
    DECODE = "decode"
    PREFILL = "prefill"

    def __str__(self) -> str:
        return str(self.value)

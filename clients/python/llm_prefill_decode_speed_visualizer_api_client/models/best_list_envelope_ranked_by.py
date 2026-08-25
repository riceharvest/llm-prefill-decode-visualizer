from enum import Enum


class BestListEnvelopeRankedBy(str, Enum):
    COST = "cost"
    DECODE = "decode"
    PREFILL = "prefill"
    WALLTIME = "walltime"

    def __str__(self) -> str:
        return str(self.value)

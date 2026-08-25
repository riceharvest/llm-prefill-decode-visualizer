from enum import Enum

class GetBestConfigsBy(str, Enum):
    CONFIDENCE = "confidence"
    COST = "cost"
    DECODE = "decode"
    EFFICIENCY = "efficiency"
    PREFILL = "prefill"
    WALLTIME = "walltime"

    def __str__(self) -> str:
        return str(self.value)

from enum import Enum


class GetApiComputeModel(str, Enum):
    AGENTIC = "agentic"
    BATCHED = "batched"
    COST = "cost"
    FLAGGED = "flagged"
    KVCACHE = "kvCache"
    SINGLETURN = "singleTurn"
    SPECULATIVE = "speculative"

    def __str__(self) -> str:
        return str(self.value)

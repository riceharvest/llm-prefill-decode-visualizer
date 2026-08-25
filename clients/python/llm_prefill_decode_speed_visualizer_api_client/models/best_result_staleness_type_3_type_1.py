from enum import Enum

class BestResultStalenessType3Type1(str, Enum):
    AGING = "aging"
    FRESH = "fresh"
    STALE = "stale"
    UNKNOWN = "unknown"

    def __str__(self) -> str:
        return str(self.value)

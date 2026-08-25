from enum import Enum


class HardwareSummaryEnvelopeHardwareGroupsItemStalenessType3Type1(str, Enum):
    AGING = "aging"
    FRESH = "fresh"
    STALE = "stale"
    UNKNOWN = "unknown"

    def __str__(self) -> str:
        return str(self.value)

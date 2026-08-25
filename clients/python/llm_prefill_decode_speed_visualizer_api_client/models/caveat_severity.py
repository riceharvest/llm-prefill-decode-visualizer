from enum import Enum

class CaveatSeverity(str, Enum):
    HIGH = "high"
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    WARNING = "warning"

    def __str__(self) -> str:
        return str(self.value)

from enum import Enum

class ContradictionKind(str, Enum):
    POOR_SCALING = "poor_scaling"
    SLOWER_THAN_SINGLE = "slower_than_single"

    def __str__(self) -> str:
        return str(self.value)

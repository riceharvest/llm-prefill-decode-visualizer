from enum import Enum

class ReplayCalculationEndpoint(str, Enum):
    BEST = "best"
    COMPUTE = "compute"

    def __str__(self) -> str:
        return str(self.value)

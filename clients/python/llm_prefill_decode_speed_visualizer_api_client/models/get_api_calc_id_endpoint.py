from enum import Enum


class GetApiCalcIdEndpoint(str, Enum):
    BEST = "best"
    COMPUTE = "compute"

    def __str__(self) -> str:
        return str(self.value)

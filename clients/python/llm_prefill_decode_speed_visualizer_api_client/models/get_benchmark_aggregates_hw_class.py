from enum import Enum

class GetBenchmarkAggregatesHwClass(str, Enum):
    CPU_ONLY = "cpu_only"
    DISCRETE_GPU = "discrete_gpu"
    UNIFIED = "unified"

    def __str__(self) -> str:
        return str(self.value)

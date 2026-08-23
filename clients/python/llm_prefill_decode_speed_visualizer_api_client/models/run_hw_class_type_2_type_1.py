from enum import Enum

class RunHwClassType2Type1(str, Enum):
    CPU_ONLY = "cpu_only"
    DISCRETE_GPU = "discrete_gpu"
    UNIFIED = "unified"

    def __str__(self) -> str:
        return str(self.value)

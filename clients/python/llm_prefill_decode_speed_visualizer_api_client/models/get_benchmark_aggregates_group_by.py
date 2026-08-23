from enum import Enum

class GetBenchmarkAggregatesGroupBy(str, Enum):
    HARDWARE = "hardware"
    HARDWAREMODEL = "hardwareModel"
    MODEL = "model"
    QUANT = "quant"

    def __str__(self) -> str:
        return str(self.value)

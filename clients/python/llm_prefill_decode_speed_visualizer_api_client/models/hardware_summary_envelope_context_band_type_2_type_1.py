from enum import Enum

class HardwareSummaryEnvelopeContextBandType2Type1(str, Enum):
    LT1K = "lt1k"
    VALUE_1 = "1k-8k"
    VALUE_2 = "8k-32k"
    VALUE_3 = "32k+"

    def __str__(self) -> str:
        return str(self.value)

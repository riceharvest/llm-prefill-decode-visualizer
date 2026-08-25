"""A client library for accessing LLM Prefill & Decode Speed Visualizer API"""

from .client import AuthenticatedClient, Client

__all__ = (
    "AuthenticatedClient",
    "Client",
)

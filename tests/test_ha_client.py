import pytest
from unittest.mock import patch, Mock
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ha_client import HAClient

@pytest.fixture
def client():
    return HAClient(base_url="http://localhost:8123", token="test_token")

def test_get_state_returns_state_dict(client):
    mock_resp = Mock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"entity_id": "lock.front_door", "state": "locked"}
    with patch("ha_client.requests.get", return_value=mock_resp):
        result = client.get_state("lock.front_door")
    assert result["state"] == "locked"

def test_get_states_returns_list(client):
    mock_resp = Mock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = [
        {"entity_id": "lock.front_door", "state": "locked"},
        {"entity_id": "cover.double_car_garage_door", "state": "closed"},
    ]
    with patch("ha_client.requests.get", return_value=mock_resp):
        result = client.get_states()
    assert len(result) == 2
    assert result[0]["entity_id"] == "lock.front_door"

def test_call_service_sends_correct_payload(client):
    mock_resp = Mock()
    mock_resp.status_code = 200
    with patch("ha_client.requests.post", return_value=mock_resp) as mock_post:
        client.call_service("lock", "lock", "lock.front_door")
    mock_post.assert_called_once()
    call_args = mock_post.call_args
    assert "lock/lock" in call_args[0][0]
    assert call_args[1]["json"] == {"entity_id": "lock.front_door"}

def test_call_service_raises_on_failure(client):
    mock_resp = Mock()
    mock_resp.status_code = 400
    mock_resp.text = "Bad request"
    with patch("ha_client.requests.post", return_value=mock_resp):
        with pytest.raises(RuntimeError, match="HA API error"):
            client.call_service("lock", "lock", "lock.front_door")

def test_run_script_calls_correct_endpoint(client):
    mock_resp = Mock()
    mock_resp.status_code = 200
    with patch("ha_client.requests.post", return_value=mock_resp) as mock_post:
        client.run_script("script.goodnight")
    call_url = mock_post.call_args[0][0]
    assert "script/turn_on" in call_url
    assert mock_post.call_args[1]["json"] == {"entity_id": "script.goodnight"}

def test_get_state_raises_on_failure(client):
    mock_resp = Mock()
    mock_resp.status_code = 404
    mock_resp.text = "Not found"
    with patch("ha_client.requests.get", return_value=mock_resp):
        with pytest.raises(RuntimeError, match="HA API error"):
            client.get_state("lock.nonexistent")

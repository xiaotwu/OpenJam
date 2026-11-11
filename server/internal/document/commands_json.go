package document

import (
	"bytes"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

func canonicalJSON(data []byte) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	value, err := canonicalValue(value)
	if err != nil {
		return nil, err
	}
	return json.Marshal(value)
}

func canonicalValue(value any) (any, error) {
	switch value := value.(type) {
	case map[string]any:
		for key, child := range value {
			if strings.ContainsRune(key, 0) {
				return nil, errors.New("JSON key contains a null byte")
			}
			canonical, err := canonicalValue(child)
			if err != nil {
				return nil, err
			}
			value[key] = canonical
		}
	case []any:
		for i, child := range value {
			canonical, err := canonicalValue(child)
			if err != nil {
				return nil, err
			}
			value[i] = canonical
		}
	case json.Number:
		return canonicalNumber(string(value))
	case string:
		if strings.ContainsRune(value, 0) {
			return nil, errors.New("JSON string contains a null byte")
		}
	}
	return value, nil
}

// Represent a decimal by its coefficient and power of ten without float64
// rounding or expanding its exponent into a potentially large string.
func canonicalNumber(number string) (json.Number, error) {
	sign := ""
	if strings.HasPrefix(number, "-") {
		sign, number = "-", number[1:]
	}
	var exponent int64
	if index := strings.IndexAny(number, "eE"); index >= 0 {
		parsed, err := strconv.ParseInt(number[index+1:], 10, 32)
		if err != nil {
			return "", err
		}
		exponent, number = parsed, number[:index]
	}
	if dot := strings.IndexByte(number, '.'); dot >= 0 {
		exponent -= int64(len(number) - dot - 1)
		number = number[:dot] + number[dot+1:]
	}
	coefficient := strings.TrimLeft(number, "0")
	if coefficient == "" {
		return "0", nil
	}
	digits := strings.TrimRight(coefficient, "0")
	exponent += int64(len(coefficient) - len(digits))
	if exponent < -16383 || exponent+int64(len(digits)) > 131072 {
		return "", errors.New("JSON number exceeds the database numeric range")
	}
	return json.Number(sign + digits + "e" + strconv.FormatInt(exponent, 10)), nil
}

func equalJSON(first, second json.RawMessage) bool {
	if len(first) == 0 {
		first = json.RawMessage("null")
	}
	if len(second) == 0 {
		second = json.RawMessage("null")
	}
	if bytes.Equal(first, second) {
		return true
	}
	firstCanonical, firstErr := canonicalJSON(first)
	secondCanonical, secondErr := canonicalJSON(second)
	return firstErr == nil && secondErr == nil && bytes.Equal(firstCanonical, secondCanonical)
}

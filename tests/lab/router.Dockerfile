FROM alpine:3.20
RUN apk add --no-cache iptables iproute2
CMD ["sleep", "infinity"]
